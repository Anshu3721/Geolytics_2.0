from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import os
import json
import logging
from utils import get_geojson_with_join
import pandas as pd
import simplekml  
from fastapi import Request
import io
from fastapi.responses import StreamingResponse
import geopandas as gpd
from typing import Literal
from shapely.geometry import box
import tempfile






# === Setup logging ===
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

# === Load .env ===
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:12345@10.133.132.90:5432/TPGA01")
TEMPLATE_DIR = "./templates"
os.makedirs(TEMPLATE_DIR, exist_ok=True)

# === FastAPI app ===
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = create_engine(DATABASE_URL)

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
    print("Received payload:", json.dumps(payload, indent=2))

    physical_table = payload.get("physical_table")
    physical_columns_map = payload.get("physical_columns")
    physical_extra_cols = payload.get("physical_extra_cols", [])
    target_table = payload.get("target_table")
    target_cols = payload.get("target_columns", [])
    join_on = payload.get("join_on")

    if not all([physical_table, physical_columns_map]):
        raise HTTPException(status_code=400, detail="`physical_table` and `physical_columns` are required.")

    required_roles = ["site_id", "cellname", "lat", "lon", "azimuth"]
    if not all(role in physical_columns_map for role in required_roles):
        raise HTTPException(status_code=400, detail=f"All required roles must be mapped: {required_roles}")

    if target_table and not (join_on and "physical" in join_on and "target" in join_on):
        raise HTTPException(status_code=400, detail="If `target_table` is provided, `join_on` mapping is required.")

    with engine.connect() as conn:
        all_db_tables = [row[0] for row in conn.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        )]

        if physical_table not in all_db_tables:
            raise HTTPException(status_code=400, detail=f"Invalid physical_table: {physical_table}")

        all_physical_db_cols = [row[0] for row in conn.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :table"),
            {"table": physical_table}
        )]

        all_requested_physical_cols = list(physical_columns_map.values()) + physical_extra_cols
        for col in all_requested_physical_cols:
            if col not in all_physical_db_cols:
                raise HTTPException(status_code=400, detail=f"Invalid column in physical table: {col}")

        all_target_db_cols = []
        if target_table:
            if target_table not in all_db_tables:
                raise HTTPException(status_code=400, detail=f"Invalid target_table: {target_table}")

            all_target_db_cols = [row[0] for row in conn.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = :table"),
                {"table": target_table}
            )]

            for col in target_cols:
                if col not in all_target_db_cols:
                    raise HTTPException(status_code=400, detail=f"Invalid column in target table: {col}")

            # ✅ Validate join_on columns
            join_phys = join_on.get("physical")
            join_target = join_on.get("target")

            if join_phys not in all_physical_db_cols:
                raise HTTPException(status_code=400, detail=f"Invalid join column on physical table: {join_phys}")

            if join_target not in all_target_db_cols:
                raise HTTPException(status_code=400, detail=f"Invalid join column on target table: {join_target}")

        # 🏗️ Safe query construction
        select_clauses = []
        for role, col_name in physical_columns_map.items():
            select_clauses.append(f'p."{col_name}" AS "{role}"')

        for col_name in physical_extra_cols:
            if col_name not in physical_columns_map.values():
                select_clauses.append(f'p."{col_name}"')

        if target_table:
            for col_name in target_cols:
                select_clauses.append(f't."{col_name}" AS "target_{col_name}"')

        select_sql = ", ".join(select_clauses)
        from_sql = f'FROM "{physical_table}" AS p'
        if target_table:
            from_sql += f' LEFT JOIN "{target_table}" AS t ON p."{join_phys}" = t."{join_target}"'

        where_sql = f'WHERE p."{physical_columns_map["lat"]}" IS NOT NULL AND p."{physical_columns_map["lon"]}" IS NOT NULL'
        final_query_str = f"SELECT {select_sql} {from_sql} {where_sql}"
        print("🚨 Final SQL Query:", final_query_str)

        final_query = text(final_query_str)

        try:
            result = conn.execute(final_query).mappings()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")

        features = []
        for row in result:
            row_dict = dict(row)
            try:
                lon = float(row_dict.pop('lon'))
                lat = float(row_dict.pop('lat'))

                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {k: v for k, v in row_dict.items() if v is not None}
                })
            except (ValueError, KeyError, TypeError):
                continue

        return {"type": "FeatureCollection", "features": features}
    







@app.post("/save-template")
def save_template(template: dict):
    name = template.get("name")
    config = template.get("config")
    if not name or not config:
        raise HTTPException(status_code=400, detail="Template must have a name and config.")
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
def get_column_range(table: str = Query(...), column: str = Query(...)):
    if not table.replace('_', '').isalnum() or not column.replace('_', '').isalnum():
        raise HTTPException(status_code=400, detail="Invalid table or column format.")
    with engine.connect() as conn:
        try:
            result = conn.execute(text(f'SELECT MIN("{column}"), MAX("{column}") FROM "{table}"')).fetchone()
            return {
                "min": float(result[0]) if result[0] is not None else None,
                "max": float(result[1]) if result[1] is not None else None
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch range: {str(e)}")
        
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
        # Read file
        if file.filename.endswith('.csv'):
            df = pd.read_csv(file.file)
        else:
            df = pd.read_excel(file.file)

        # Normalize column names
        original_columns = df.columns
        df.columns = [col.strip().lower() for col in original_columns]

        # Detect lat/lon
        lat_col = next((col for col in df.columns if col in ["lat", "latitude", "y"]), None)
        lon_col = next((col for col in df.columns if col in ["lon", "lng", "long", "longitude", "x"]), None)

        if not lat_col or not lon_col:
            raise HTTPException(status_code=400, detail="Missing lat/long columns.")

        # Drop missing coordinates
        df = df.dropna(subset=[lat_col, lon_col])

        # Convert to GeoDataFrame
        gdf = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df[lon_col], df[lat_col]), crs="EPSG:4326")

        # Convert to GeoJSON
        geojson = json.loads(gdf.to_json())

        # Dynamically extract numeric KPI columns (excluding lat/lon)
        kpi_candidates = [
            col for col in df.select_dtypes(include=["number"]).columns
            if col not in [lat_col, lon_col]
        ]

        return {
            "type": "FeatureCollection",
            "features": geojson["features"],
            "available_kpis": kpi_candidates  # <- ✨ Frontend uses this
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")

@app.post("/map")
def get_map_data(payload: dict):
    try:
        logger.info(f"Received payload: {payload}")
        geojson = get_geojson_with_join(
            engine=engine,
            physical_table=payload["physical_table"],
            target_table=payload["target_table"],
            physical_columns=payload["physical_columns"],
            physical_extra_cols=payload.get("physical_extra_cols", []),
            target_columns=payload.get("target_columns", []),
            join_on=payload["join_on"]
        )
        return geojson
    except Exception as e:
        logger.error(f"Error generating map: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal Server Error")


@app.post("/generate-grid")
async def generate_grid(
    file: UploadFile = File(...),
    kpi: str = Query(..., description="Column to aggregate (e.g., SINR)"),
    grid_size: float = Query(0.01, description="Grid size in degrees (approx ~1km at equator)")
):
    try:
        # Save uploaded GeoJSON temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=".geojson") as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        # Read GeoJSON normally (no need to prefix with GeoJSON:)
        gdf = gpd.read_file(tmp_path)

        if gdf.empty or 'geometry' not in gdf.columns:
            return {"error": "Uploaded file is empty or missing geometry column."}

        if kpi not in gdf.columns:
            return {"error": f"KPI column '{kpi}' not found in uploaded data."}

        # Compute bounding box
        minx, miny, maxx, maxy = gdf.total_bounds

        # Generate grid polygons
        grid_cells = []
        x = minx
        while x < maxx:
            y = miny
            while y < maxy:
                grid_cells.append(box(x, y, x + grid_size, y + grid_size))
                y += grid_size
            x += grid_size

        # Create grid GeoDataFrame
        grid = gpd.GeoDataFrame({'geometry': grid_cells}, crs=gdf.crs)

        # Spatial join (points within grid cells)
        joined = gpd.sjoin(gdf, grid, predicate='within')

        # Aggregate KPI by grid cell
        result = joined.groupby('index_right')[kpi].mean().reset_index()

        # Assign results to grid
        grid['kpi_avg'] = result.set_index('index_right')[kpi]
        grid['kpi_avg'] = grid['kpi_avg'].fillna(0)

        # Clean up temp file
        os.remove(tmp_path)

        # Return result as GeoJSON
        return json.loads(grid.to_json())

    except Exception as e:
        return {"error": str(e)}