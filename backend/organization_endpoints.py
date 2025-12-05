from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
import uuid
from sqlalchemy import create_engine, text

from dependencies import get_current_user, require_admin, hash_password

router = APIRouter()

class DatabaseConnection(BaseModel):
    name: str = Field(..., min_length=1)
    connection_type: str = Field(..., pattern="^(postgresql|mysql|sql_server)$")
    host: str = Field(..., min_length=1)
    port: int = Field(..., gt=0, lt=65536)
    database: str = Field(..., min_length=1)
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    ssl_enabled: bool = False
    sync_users: bool = False
    user_table_name: str = Field(default="users", description="The table to sync users from")
    user_group_column: str = Field(default="department", description="Column to map to user group")

@router.get("/organizations/database-connections")
async def get_connections(current_user = Depends(require_admin)):
    from server import db
    connections = await db.db_connections.find(
        {"organization_id": current_user.organization_id}, 
        {"_id": 0}
    ).to_list(100)
    return {"connections": connections}

@router.post("/organizations/database-connections")
async def create_connection(conn: DatabaseConnection, current_user = Depends(require_admin)):
    from server import db
    new_conn = conn.model_dump()
    new_conn["id"] = str(uuid.uuid4())
    new_conn["organization_id"] = current_user.organization_id
    new_conn["created_at"] = datetime.now().isoformat()
    new_conn["sync_status"] = "never_synced"
    
    await db.db_connections.insert_one(new_conn)
    return {"success": True, "connection_id": new_conn["id"]}

@router.post("/organizations/database-connections/{connection_id}/test")
async def test_connection(connection_id: str, current_user = Depends(require_admin)):
    from server import db
    conn = await db.db_connections.find_one({"id": connection_id})
    if not conn: raise HTTPException(status_code=404, detail="Connection not found")
    
    db_url = f"postgresql://{conn['username']}:{conn['password']}@{conn['host']}:{conn['port']}/{conn['database']}"
    if conn.get('ssl_enabled'): db_url += "?sslmode=require"

    try:
        engine = create_engine(db_url)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "success", "message": "Connection established successfully!"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@router.post("/organizations/database-connections/{connection_id}/sync-users")
async def sync_users(connection_id: str, current_user = Depends(require_admin)):
    from server import db
    conn = await db.db_connections.find_one({"id": connection_id})
    if not conn: raise HTTPException(status_code=404, detail="Connection not found")

    db_url = f"postgresql://{conn['username']}:{conn['password']}@{conn['host']}:{conn['port']}/{conn['database']}"
    if conn.get('ssl_enabled'): db_url += "?sslmode=require"

    synced_count = 0
    updated_count = 0
    
    engine = create_engine(db_url)
    
    table_name = conn.get("user_table_name", "users")
    group_col = conn.get("user_group_column", "department")

    if not table_name.replace("_", "").isalnum() or not group_col.replace("_", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid table or column name")

    result_rows = []

    try:
        with engine.connect() as connection:
            query = text(f'SELECT email, full_name, "{group_col}" FROM "{table_name}"')
            result_rows = connection.execute(query).fetchall()
            
    except Exception as e1:
        print(f"Quoted sync failed: {e1}. Retrying unquoted...")
        try:
            with engine.connect() as connection:
                query = text(f"SELECT email, full_name, {group_col} FROM {table_name}")
                result_rows = connection.execute(query).fetchall()
        except Exception as e2:
            print(f"Unquoted sync failed: {e2}. Using fallback...")
            try:
                with engine.connect() as connection:
                    query = text(f"SELECT email, full_name, 'General' as group_name FROM {table_name}")
                    result_rows = connection.execute(query).fetchall()
            except Exception as e3:
                await db.db_connections.update_one({"id": connection_id}, {"$set": {"sync_status": "error"}})
                return {"status": "error", "message": f"All sync attempts failed. Error: {str(e3)}"}

    try:
        for row in result_rows:
            email = row[0]
            full_name = row[1]
            user_group = str(row[2]) if (len(row) > 2 and row[2]) else "General"
            
            existing = await db.users.find_one({"email": email})
            
            if not existing:
                new_user = {
                    "id": str(uuid.uuid4()),
                    "email": email,
                    "full_name": full_name,
                    "role": "user",
                    "user_group": user_group,
                    "organization_id": current_user.organization_id,
                    "is_active": True,
                    "created_at": datetime.now().isoformat(),
                    "source": "external_sync",
                    "password_hash": hash_password("Katalusis2025!"),
                    "must_change_password": True
                }
                await db.users.insert_one(new_user)
                synced_count += 1
            else:
                # ✅ SMART UPDATE: Only update if the group actually changed
                current_group = existing.get("user_group")
                if current_group != user_group:
                    await db.users.update_one(
                        {"email": email},
                        {"$set": {"user_group": user_group}}
                    )
                    updated_count += 1

        await db.db_connections.update_one(
            {"id": connection_id},
            {"$set": {"last_sync": datetime.now().isoformat(), "sync_status": "success"}}
        )

        return {
            "status": "success", 
            "synced_count": synced_count, 
            "updated_count": updated_count 
        }

    except Exception as e:
        await db.db_connections.update_one({"id": connection_id}, {"$set": {"sync_status": "error"}})
        return {"status": "error", "message": str(e)}

@router.get("/organizations/current")
async def get_current_org(current_user = Depends(get_current_user)):
    return {"id": "org-default", "name": "Katalusis Demo Organization", "subdomain": "demo"}
    
@router.get("/organizations/sso-config")
async def get_sso_config(current_user = Depends(require_admin)):
    return {"sso_configs": []}

@router.delete("/organizations/database-connections/{connection_id}")
async def delete_connection(connection_id: str, current_user = Depends(require_admin)):
    from server import db
    result = await db.db_connections.delete_one({"id": connection_id})
    if result.deleted_count == 0: raise HTTPException(status_code=404, detail="Connection not found")
    return {"success": True}