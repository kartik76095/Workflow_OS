from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field  # <--- Add Field here
from datetime import datetime
import uuid
from sqlalchemy import create_engine, text

from dependencies import get_current_user, require_admin, hash_password
# Import db inside functions to avoid circular imports

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
    # NEW: Dynamic Table Name
    user_table_name: str = Field(default="users", description="The table to sync users from")

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

# ✅ NEW: Test the connection
@router.post("/organizations/database-connections/{connection_id}/test")
async def test_connection(connection_id: str, current_user = Depends(require_admin)):
    from server import db
    
    # 1. Get credentials from Mongo
    conn = await db.db_connections.find_one({"id": connection_id})
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    # 2. Construct Connection String (Postgres)
    # Format: postgresql://user:pass@host:port/dbname
    db_url = f"postgresql://{conn['username']}:{conn['password']}@{conn['host']}:{conn['port']}/{conn['database']}"
    if conn.get('ssl_enabled'):
        db_url += "?sslmode=require"

    # 3. Try to Connect
    try:
        engine = create_engine(db_url)
        with engine.connect() as connection:
            # Run a simple ping query
            connection.execute(text("SELECT 1"))
            
        return {"status": "success", "message": "Connection established successfully!"}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

# ✅ NEW: Sync Users
@router.post("/organizations/database-connections/{connection_id}/sync-users")
async def sync_users(connection_id: str, current_user = Depends(require_admin)):
    from server import db
    
    # 1. Get credentials
    conn = await db.db_connections.find_one({"id": connection_id})
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    db_url = f"postgresql://{conn['username']}:{conn['password']}@{conn['host']}:{conn['port']}/{conn['database']}"
    if conn.get('ssl_enabled'):
        db_url += "?sslmode=require"

    synced_count = 0
    
    try:
        engine = create_engine(db_url)
        with engine.connect() as connection:
            # 2. Query the external 'users' table
            # ✅ NEW: Use the dynamic table name provided by the user
            table_name = conn.get("user_table_name", "users")
            
            # Basic SQL Injection protection (ensure it only contains safe chars)
            if not table_name.replace("_", "").isalnum():
                raise HTTPException(status_code=400, detail="Invalid table name")
                
            # Construct query dynamically
            # Note: In a real enterprise app, you'd also let them map the 'email' and 'full_name' columns!
            query = text(f"SELECT email, full_name FROM {table_name}")
            result = connection.execute(query)
            
            for row in result:
                email = row[0]
                full_name = row[1]
                
                # 3. Check if user exists locally
                existing = await db.users.find_one({"email": email})
                
                if not existing:
                    # 4. Create the user in Katalusis
                    new_user = {
                        "id": str(uuid.uuid4()),
                        "email": email,
                        "full_name": full_name,
                        "role": "user",
                        "organization_id": current_user.organization_id,
                        "is_active": True,
                        "created_at": datetime.now().isoformat(),
                        "source": "external_sync",
                        # NEW: Set a default password for synced users
                        "password_hash": hash_password("Katalusis2025!"),
                        # NEW: Force them to change this immediately
                        "must_change_password": True
                    }
                    await db.users.insert_one(new_user)
                    synced_count += 1

        # Update sync status
        await db.db_connections.update_one(
            {"id": connection_id},
            {"$set": {"last_sync": datetime.now().isoformat(), "sync_status": "success"}}
        )

        return {"status": "success", "synced_count": synced_count}

    except Exception as e:
        await db.db_connections.update_one(
            {"id": connection_id},
            {"$set": {"sync_status": "error"}}
        )
        return {"status": "error", "message": str(e)}

@router.get("/organizations/current")
async def get_current_org(current_user = Depends(get_current_user)):
    return {
        "id": "org-default",
        "name": "Katalusis Demo Organization",
        "subdomain": "demo"
    }
    
@router.get("/organizations/sso-config")
async def get_sso_config(current_user = Depends(require_admin)):
    return {"sso_configs": []}

@router.delete("/organizations/database-connections/{connection_id}")
async def delete_connection(connection_id: str, current_user = Depends(require_admin)):
    from server import db
    result = await db.db_connections.delete_one({"id": connection_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"success": True}