from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import os
import json
import logging
import pandas as pd
import simplekml
import geopandas as gpd
from typing import Literal
from shapely.geometry import box
import tempfile
import io

drive_test_store = {"df": None}


# === Setup logging ===
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

# === Load .env ===
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:12345@10.133.132.90:5432/TPGA01")
TEMPLATE_DIR = "./templates"
os.makedirs(TEMPLATE_DIR, exist_ok=True)

# === FastAPI app ===
app = FastAPI(root_path="/geo-api")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = create_engine(DATABASE_URL)

# === Global cache for drive test ===
drive_test_store = {
    "df": None,   # will hold the uploaded dataframe
    "columns": [] # numeric KPI columns
}


# === Routes ===
@app.get("/tables")
def get_tables():
    with engine.connect() as conn:
        res = conn.execute(text("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        """))
        return [row[0] for row in res]

@app.get("/columns/{table}")
def get_columns_for_table(table: str):
    if not table.replace('_', '').isalnum():
        raise HTTPException(status_code=400, detail="Invalid table name format.")
    with engine.connect() as conn:
        res = conn.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :table"),
            {"table": table}
        )
        column_list = [row[0] for row in res]
        if not column_list:
            raise HTTPException(status_code=404, detail=f"Table '{table}' not found.")
        return column_list

@app.post("/query")
async def query_data(payload: dict):
    logger.info("Received payload: %s", json.dumps(payload, indent=2))

    physical_table = payload.get("physical_table")
    physical_columns_map = payload.get("physical_columns")
    physical_extra_cols = payload.get("physical_extra_cols", [])
    target_joins = payload.get("target_joins", [])
    layer_column = payload.get("layerColumn") or ""
    band_column = payload.get("bandColumn") or ""
    kpi_column = payload.get("kpiColumn") or ""

    if not all([physical_table, physical_columns_map]):
        raise HTTPException(status_code=400, detail="`physical_table` and `physical_columns` are required.")

    required_roles = ["site_id", "cellname", "lat", "lon", "azimuth"]
    if not all(role in physical_columns_map for role in required_roles):
        raise HTTPException(status_code=400, detail=f"All required roles must be mapped: {required_roles}")

    with engine.connect() as conn:
        all_tables = [row[0] for row in conn.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        )]
        if physical_table not in all_tables:
            raise HTTPException(status_code=400, detail=f"Invalid physical_table: {physical_table}")

        all_physical_cols = [row[0] for row in conn.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :table"),
            {"table": physical_table}
        )]

        # Ensure selected column names are valid
        for col in list(physical_columns_map.values()) + physical_extra_cols:
            if col not in all_physical_cols:
                raise HTTPException(status_code=400, detail=f"Invalid column in physical table: {col}")

        # === SELECT Clause Construction ===
        select_clauses = [
            f'p."{col}" AS "{role}"' for role, col in physical_columns_map.items()
        ]
        for col in physical_extra_cols:
            select_clauses.append(f'p."{col}" AS "{col}"')

        for col in {layer_column, band_column, kpi_column}:
            if col and col in all_physical_cols and col not in physical_columns_map.values() and col not in physical_extra_cols:
                select_clauses.append(f'p."{col}" AS "{col}"')

        # === JOIN Clause Construction ===
        join_clauses = ""
        join_alias_counter = 1
        for join in target_joins:
            target_table = join.get("table")
            target_columns = join.get("target_columns", [])
            join_on = join.get("join_on", {})

            if not (target_table and join_on and "physical" in join_on and "target" in join_on):
                raise HTTPException(status_code=400, detail="Invalid target join configuration.")
            if target_table not in all_tables:
                raise HTTPException(status_code=400, detail=f"Invalid target_table: {target_table}")

            all_target_cols = [row[0] for row in conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = :table"),
                {"table": target_table}
            )]
            for col in target_columns:
                if col not in all_target_cols:
                    raise HTTPException(status_code=400, detail=f"Invalid column in {target_table}: {col}")

            join_phys_col = join_on["physical"]
            join_target_col = join_on["target"]
            if join_phys_col not in all_physical_cols or join_target_col not in all_target_cols:
                raise HTTPException(status_code=400, detail=f"Invalid join keys between {physical_table} and {target_table}")

            alias = f"t{join_alias_counter}"
            join_clauses += f' LEFT JOIN "{target_table}" AS {alias} ON p."{join_phys_col}" = {alias}."{join_target_col}"'
            for col in target_columns:
                select_clauses.append(f'{alias}."{col}" AS "{target_table}_{col}"')
            join_alias_counter += 1

        select_sql = ", ".join(select_clauses)
        where_sql = f'WHERE p."{physical_columns_map["lat"]}" IS NOT NULL AND p."{physical_columns_map["lon"]}" IS NOT NULL'
        full_query = f'SELECT {select_sql} FROM "{physical_table}" AS p{join_clauses} {where_sql}'

        logger.info("🚨 Final SQL Query: %s", full_query)

        try:
            result = conn.execute(text(full_query)).mappings()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")

        features = []
        for row in result:
            row_dict = dict(row)

            try:
                lon = float(row_dict.pop("lon"))
                lat = float(row_dict.pop("lat"))
                azimuth = float(row_dict.get("azimuth", 0))

                # Parse KPI and other dynamic columns robustly
                for col in {layer_column, band_column, kpi_column}:
                    if col in row_dict:
                        val = row_dict[col]
                        try:
                            parsed = float(val)
                            if str(parsed).lower() in ["", "null", "--"]:
                                row_dict[col] = None
                            else:
                                row_dict[col] = parsed
                        except (TypeError, ValueError):
                            row_dict[col] = None

                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": row_dict
                })

            except (ValueError, TypeError, KeyError):
                continue

    if features:
        logger.info("✅ Sample feature property keys: %s", list(features[0]["properties"].keys()))

    return {"type": "FeatureCollection", "features": features}
@app.get("/drive-test/columns")
def get_drive_test_columns():
    df = drive_test_store["df"]

    if df is None:
        raise HTTPException(status_code=404, detail="No drive test data uploaded")

    available_kpis = drive_test_store.get("columns", [])

    # Fallback if not populated yet
    if not available_kpis:
        available_kpis = [
            col for col in df.columns if pd.api.types.is_numeric_dtype(df[col])
        ]

    return {"columns": available_kpis}


@app.post("/save-template")
def save_template(template: dict):
    name = template.get("name")
    config = template.get("config")
    if not name or not config:
        raise HTTPException(status_code=400, detail="Template must have a name and config.")
    if not isinstance(config.get("target_joins", []), list):
        raise HTTPException(status_code=400, detail="Expected 'target_joins' to be a list.")
    path = os.path.join(TEMPLATE_DIR, f"{name}.json")
    with open(path, "w") as f:
        json.dump(template, f, indent=2)
    return JSONResponse(content={"message": "Template saved"}, status_code=200)

@app.get("/templates")
def list_templates():
    return [f[:-5] for f in os.listdir(TEMPLATE_DIR) if f.endswith(".json")]

@app.get("/template/{name}")
def get_template(name: str):
    path = os.path.join(TEMPLATE_DIR, f"{name}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Template not found.")
    with open(path, "r") as f:
        return json.load(f)

@app.get("/column-range")
def get_column_range(table: str, column: str):
    try:
        with engine.connect() as conn:
            # Quote table and column to preserve case sensitivity
            query_check = text(f'SELECT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL LIMIT 1')
            type_check = conn.execute(query_check).fetchone()
            if type_check is None:
                return {"min": None, "max": None, "error": "Column has no data"}

            sample_value = type_check[0]
            if not isinstance(sample_value, (int, float)):
                return {"min": None, "max": None, "error": "Non-numeric column"}

            query_range = text(f'SELECT MIN("{column}"), MAX("{column}") FROM "{table}"')
            result = conn.execute(query_range).fetchone()
            return {"min": result[0], "max": result[1]}
    except Exception as e:
        print("Error in /column-range:", e)
        return {"min": None, "max": None, "error": str(e)}


@app.post("/export")
async def export_data(request: Request):
    body = await request.json()
    format = body.get("format")
    data = body.get("data", {}).get("features", [])
    if not data:
        raise HTTPException(status_code=400, detail="No data provided.")
    df = pd.json_normalize(data)
    if format == "csv":
        stream = io.StringIO()
        df.to_csv(stream, index=False)
        stream.seek(0)
        return StreamingResponse(iter([stream.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=export.csv"})
    elif format == "kml":
        kml = simplekml.Kml()
        for feature in data:
            coords = feature.get("geometry", {}).get("coordinates")
            props = feature.get("properties", {})
            if coords and len(coords) == 2:
                kml.newpoint(name=str(props.get("Site_ID", "")), coords=[(coords[0], coords[1])])
        kml_bytes = kml.kml()
        return StreamingResponse(io.BytesIO(kml_bytes.encode('utf-8')), media_type="application/vnd.google-earth.kml+xml", headers={"Content-Disposition": "attachment; filename=export.kml"})
    else:
        raise HTTPException(status_code=400, detail="Invalid format requested.")


@app.post("/upload-drive-test")
async def upload_drive_test(file: UploadFile = File(...)):
    try:
        print("🚀 upload-drive-test called")

        if not file:
            raise HTTPException(status_code=400, detail="❌ No file uploaded")

        print(f"📂 File received: {file.filename}, ContentType: {file.content_type}")

        contents = await file.read()
        print(f"📏 File size: {len(contents)} bytes")
        print("🔎 First 200 bytes of file:\n", contents[:200])

        df = None
        if file.filename.lower().endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents), encoding="utf-8-sig")

        elif file.filename.lower().endswith((".xls", ".xlsx")):
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")
        else:
            raise HTTPException(status_code=400, detail="❌ Unsupported file format")

        if df is None or df.empty:
            raise HTTPException(status_code=400, detail="❌ Uploaded file is empty or unreadable")

        print("✅ DataFrame loaded:", df.shape)
        print("📑 Columns:", df.columns.tolist())
        print("🔍 First 5 rows:\n", df.head().to_dict(orient="records"))

        # --- Smarter lat/lon detection ---
        lat_keywords = ["lat", "latitude", "gps_lat", "positioning_lat", "y"]
        lon_keywords = ["lon", "lng", "long", "longitude", "gps_lon", "gps_lng", "positioning_lon", "x"]

        lat_candidates = [c for c in df.columns if any(k in c.lower().replace(" ", "").replace("_", "") for k in lat_keywords)]
        lon_candidates = [c for c in df.columns if any(k in c.lower().replace(" ", "").replace("_", "") for k in lon_keywords)]

        lat_col = lat_candidates[0] if lat_candidates else None
        lon_col = lon_candidates[0] if lon_candidates else None

        if not lat_col or not lon_col:
            # Instead of crashing, return available columns for manual mapping
            return {
                "error": "Could not detect latitude/longitude automatically",
                "columns": df.columns.tolist(),
                "sample_rows": df.head(3).to_dict(orient="records")
            }

        print(f"📍 Using lat={lat_col}, lon={lon_col}")

        # --- Drop missing coords ---
        df = df.dropna(subset=[lat_col, lon_col])
        print(f"✅ After dropping NaN coords: {df.shape}")

        # --- Numeric KPI columns ---
        exclude = {lat_col, lon_col, "time", "imei", "imsi", "device_name"}
        kpi_candidates = [
            col for col in df.columns
            if col not in exclude and pd.api.types.is_numeric_dtype(df[col])
        ]
        print(f"📊 KPI candidates: {kpi_candidates}")

        if not kpi_candidates:
            return {
                "error": "No numeric KPI columns detected",
                "columns": df.columns.tolist()
            }

        # --- Convert to GeoJSON ---
        features = []
        for _, row in df.iterrows():
            try:
                lon, lat = float(row[lon_col]), float(row[lat_col])
                props = {col: row[col] for col in kpi_candidates if pd.notna(row[col])}
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": props
                })
            except Exception as row_err:
                print("⚠️ Row skipped:", row_err)
                continue

        geojson = {"type": "FeatureCollection", "features": features}
        print(f"✅ Generated {len(features)} features")

        drive_test_store["df"] = df
        drive_test_store["columns"] = kpi_candidates

        return {"geojson": geojson, "available_kpis": kpi_candidates}

    except Exception as e:
        import traceback
        print("❌ CRASH in upload-drive-test:", e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Server crash: {str(e)}")
    
    
    
@app.get("/drive-test/column-range")
def get_drive_test_column_range(column: str):
    df = drive_test_store["df"]

    if df is None or column not in df.columns:
        raise HTTPException(status_code=404, detail=f"Column {column} not found in drive test data.")

    col_series = df[column].dropna()

    if col_series.empty:
        return {"min": None, "max": None, "error": "Empty column"}

    # ✅ If numeric → return min/max
    if pd.api.types.is_numeric_dtype(col_series):
        return {
            "type": "numeric",
            "min": float(col_series.min()),
            "max": float(col_series.max())
        }

    # ✅ If datetime → return earliest/latest
    if pd.api.types.is_datetime64_any_dtype(col_series):
        return {
            "type": "datetime",
            "min": str(col_series.min()),
            "max": str(col_series.max())
        }

    # ✅ If categorical/string → return unique values (limited)
    if pd.api.types.is_string_dtype(col_series) or col_series.dtype == "object":
        unique_vals = col_series.unique().tolist()
        return {
            "type": "categorical",
            "unique_values": unique_vals[:50],  # limit to avoid huge response
            "count": len(unique_vals)
        }

    # fallback
    return {"error": f"Unsupported column type: {col_series.dtype}"}





    



 

@app.post("/generate-grid")
async def generate_grid(
    file: UploadFile = File(...),
    kpi: str = Query(..., description="Column to aggregate (e.g., SINR)"),
    grid_size: float = Query(0.01, description="Grid size in degrees (approx ~1km at equator)")
):
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".geojson") as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name
        gdf = gpd.read_file(tmp_path)
        if gdf.empty or 'geometry' not in gdf.columns:
            return {"error": "Uploaded file is empty or missing geometry column."}
        if kpi not in gdf.columns:
            return {"error": f"KPI column '{kpi}' not found in uploaded data."}
        minx, miny, maxx, maxy = gdf.total_bounds
        grid_cells = []
        x = minx
        while x < maxx:
            y = miny
            while y < maxy:
                grid_cells.append(box(x, y, x + grid_size, y + grid_size))
                y += grid_size
            x += grid_size
        grid = gpd.GeoDataFrame({'geometry': grid_cells}, crs=gdf.crs)
        joined = gpd.sjoin(gdf, grid, predicate='within')
        result = joined.groupby('index_right')[kpi].mean().reset_index()
        grid['kpi_avg'] = result.set_index('index_right')[kpi]
        grid['kpi_avg'] = grid['kpi_avg'].fillna(0)
        os.remove(tmp_path)
        return json.loads(grid.to_json())
    except Exception as e:
        return {"error": str(e)}
    

# @app.get("/drive-test/columns")
# def get_drive_test_columns():
#     df = drive_test_store["df"]

#     if df is None:
#         raise HTTPException(status_code=404, detail="No drive test data uploaded")

#     available_kpis = drive_test_store.get("columns", [])

#     # Fallback if not populated yet
#     if not available_kpis:
#         available_kpis = [
#             col for col in df.columns if pd.api.types.is_numeric_dtype(df[col])
#         ]

#     return {"columns": available_kpis}
