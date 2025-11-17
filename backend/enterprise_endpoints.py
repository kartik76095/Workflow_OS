# ==================== MODULE 1: CONNECTIVITY - WEBHOOKS & API TRIGGERS ====================

@api_router.post("/v1/webhooks", response_model=WebhookTrigger, status_code=201)
async def create_webhook_trigger(
    trigger_data: WebhookTriggerCreate,
    current_user: User = Depends(require_admin)
):
    """Create inbound webhook trigger for workflow"""
    # Generate unique hook URL
    hook_id = str(uuid.uuid4())
    hook_url = f"/api/v1/webhooks/{hook_id}"
    
    trigger = WebhookTrigger(
        **trigger_data.model_dump(),
        hook_url=hook_url,
        organization_id=current_user.organization_id
    )
    
    await db.webhook_triggers.insert_one(trigger.model_dump())
    await log_audit(current_user.id, "WEBHOOK_TRIGGER_CREATE", f"webhook-{trigger.id}")
    
    return trigger

@api_router.post("/v1/webhooks/{hook_id}")
async def webhook_listener(hook_id: str, request: Request):
    """Inbound webhook listener - triggers workflow"""
    try:
        # Get webhook configuration
        hook_config = await db.webhook_triggers.find_one({"hook_url": f"/api/v1/webhooks/{hook_id}"}, {"_id": 0})
        if not hook_config or not hook_config.get("is_active"):
            raise HTTPException(status_code=404, detail="Webhook not found or inactive")
        
        # Parse incoming payload
        payload = await request.json()
        
        # Map payload to workflow variables
        workflow_variables = {}
        for payload_field, variable_name in hook_config.get("payload_mapping", {}).items():
            if payload_field in payload:
                workflow_variables[variable_name] = payload[payload_field]
        
        # Add webhook metadata
        workflow_variables["webhook_payload"] = payload
        workflow_variables["webhook_timestamp"] = datetime.now(timezone.utc).isoformat()
        workflow_variables["webhook_source"] = hook_config["name"]
        
        # Create task and start workflow
        task = Task(
            title=f"Webhook Trigger: {hook_config['name']}",
            description=f"Task created by webhook {hook_id}",
            creator_id="system",
            organization_id=hook_config.get("organization_id"),
            workflow_id=hook_config["workflow_id"],
            metadata={"webhook_id": hook_id, "payload": payload}
        )
        
        await db.tasks.insert_one(task.model_dump())
        
        # Start workflow with webhook variables
        workflow_state = await workflow_engine.start_workflow(
            task.id, 
            hook_config["workflow_id"], 
            "system",
            workflow_variables
        )
        
        # Update webhook stats
        await db.webhook_triggers.update_one(
            {"hook_url": f"/api/v1/webhooks/{hook_id}"},
            {
                "$set": {"last_triggered": datetime.now(timezone.utc).isoformat()},
                "$inc": {"trigger_count": 1}
            }
        )
        
        await log_audit("system", "WEBHOOK_TRIGGERED", f"task-{task.id}", {
            "webhook_id": hook_id,
            "workflow_id": hook_config["workflow_id"],
            "payload_keys": list(payload.keys())
        })
        
        return {
            "success": True,
            "task_id": task.id,
            "workflow_started": True,
            "variables_mapped": len(workflow_variables)
        }
        
    except Exception as e:
        await log_audit("system", "WEBHOOK_ERROR", f"webhook-{hook_id}", {"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Webhook processing failed: {str(e)}")

@api_router.get("/v1/webhooks")
async def list_webhook_triggers(current_user: User = Depends(require_admin)):
    """List all webhook triggers for organization"""
    query = {"organization_id": current_user.organization_id} if current_user.organization_id else {}
    hooks = await db.webhook_triggers.find(query, {"_id": 0}).to_list(100)
    return {"webhook_triggers": hooks}

@api_router.delete("/v1/webhooks/{hook_id}")
async def delete_webhook_trigger(hook_id: str, current_user: User = Depends(require_admin)):
    """Delete webhook trigger"""
    result = await db.webhook_triggers.delete_one({"id": hook_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    await log_audit(current_user.id, "WEBHOOK_TRIGGER_DELETE", f"webhook-{hook_id}")
    return {"success": True}

# ==================== MODULE 2: RESILIENCE LAYER ====================

@api_router.patch("/v1/workflows/{workflow_id}/nodes/{node_id}/retry-policy")
async def update_node_retry_policy(
    workflow_id: str,
    node_id: str,
    retry_policy: Dict[str, Any],
    current_user: User = Depends(require_admin)
):
    """Update retry policy for a workflow node"""
    result = await db.workflows.update_one(
        {"id": workflow_id, "nodes.id": node_id},
        {"$set": {
            "nodes.$.retry_policy": retry_policy,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Workflow or node not found")
    
    await log_audit(current_user.id, "NODE_RETRY_POLICY_UPDATE", f"workflow-{workflow_id}", {
        "node_id": node_id,
        "retry_policy": retry_policy
    })
    
    return {"success": True, "retry_policy": retry_policy}

@api_router.post("/v1/workflows/{workflow_id}/nodes/{node_id}/retry")
async def retry_failed_node(
    workflow_id: str,
    node_id: str,
    task_id: str,
    current_user: User = Depends(require_admin)
):
    """Manually retry a failed workflow node"""
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow = await db.workflows.find_one({"id": workflow_id}, {"_id": 0})
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    
    # Find the node
    node = None
    for n in workflow.get("nodes", []):
        if n["id"] == node_id:
            node = WorkflowNode(**n)
            break
    
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    # Execute node with resilience
    try:
        result = await workflow_engine.execute_node_with_resilience(
            task_id, node, task["workflow_state"].get("variables", {}), current_user.id
        )
        
        await log_audit(current_user.id, "NODE_MANUAL_RETRY", f"task-{task_id}", {
            "node_id": node_id,
            "result": result
        })
        
        return {"success": True, "result": result}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Node retry failed: {str(e)}")

# ==================== MODULE 3: TRUST ARCHITECTURE (AUDIT LOGS) ====================

@api_router.get("/v1/audit-logs")
async def get_audit_logs(
    actor_id: Optional[str] = None,
    action: Optional[str] = None,
    target_resource: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_admin)
):
    """Query immutable audit logs with filtering"""
    query = {}
    
    # Organization isolation
    if current_user.organization_id:
        # Get users from same organization
        org_users = await db.users.find(
            {"organization_id": current_user.organization_id}, 
            {"_id": 0, "id": 1}
        ).to_list(1000)
        org_user_ids = [user["id"] for user in org_users] + ["system"]
        query["actor_id"] = {"$in": org_user_ids}
    
    # Apply filters
    if actor_id:
        query["actor_id"] = actor_id
    if action:
        query["action"] = {"$regex": action, "$options": "i"}
    if target_resource:
        query["target_resource"] = {"$regex": target_resource, "$options": "i"}
    if start_date:
        query["timestamp"] = {"$gte": start_date}
    if end_date:
        if "timestamp" in query:
            query["timestamp"]["$lte"] = end_date
        else:
            query["timestamp"] = {"$lte": end_date}
    
    # Get logs
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("timestamp", -1).skip(offset).limit(limit).to_list(limit)
    total = await db.audit_logs.count_documents(query)
    
    return {
        "audit_logs": logs,
        "total": total,
        "limit": limit,
        "offset": offset
    }

@api_router.get("/v1/audit-logs/export")
async def export_audit_logs(
    format: str = Query("csv", regex="^(csv|json)$"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(require_super_admin)
):
    """Export audit logs for compliance (Super Admin only)"""
    from fastapi.responses import StreamingResponse
    import csv
    import json
    
    query = {}
    if start_date:
        query["timestamp"] = {"$gte": start_date}
    if end_date:
        if "timestamp" in query:
            query["timestamp"]["$lte"] = end_date
        else:
            query["timestamp"] = {"$lte": end_date}
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("timestamp", 1).to_list(10000)
    
    if format == "csv":
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=["timestamp", "actor_id", "action", "target_resource", "changes"])
        writer.writeheader()
        
        for log in logs:
            writer.writerow({
                "timestamp": log["timestamp"],
                "actor_id": log["actor_id"],
                "action": log["action"],
                "target_resource": log["target_resource"],
                "changes": json.dumps(log.get("changes", {}))
            })
        
        output = stream.getvalue()
        stream.close()
        
        return StreamingResponse(
            io.BytesIO(output.encode()),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=audit_logs_{datetime.now().strftime('%Y%m%d')}.csv"}
        )
    
    else:  # JSON format
        return StreamingResponse(
            io.BytesIO(json.dumps(logs, indent=2).encode()),
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=audit_logs_{datetime.now().strftime('%Y%m%d')}.json"}
        )

# ==================== MODULE 4: AI AGENT NODE ====================

@api_router.post("/v1/ai-worker/test")
async def test_ai_worker_node(
    system_prompt: str,
    user_prompt: str,
    context_variables: Dict[str, Any] = None,
    current_user: User = Depends(get_current_user)
):
    """Test AI worker node configuration"""
    from jinja2 import Template
    
    variables = context_variables or {}
    
    # Render prompts with variables
    try:
        rendered_system = Template(system_prompt).render(**variables)
        rendered_user = Template(user_prompt).render(**variables)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Template rendering failed: {str(e)}")
    
    # Call AI
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"test-{current_user.id}",
            system_message=rendered_system
        ).with_model("openai", "gpt-4o")
        
        response = await chat.send_message(UserMessage(text=rendered_user))
        
        await log_audit(current_user.id, "AI_WORKER_TEST", "test-node", {
            "system_prompt_length": len(rendered_system),
            "user_prompt_length": len(rendered_user),
            "response_length": len(response)
        })
        
        return {
            "success": True,
            "rendered_system_prompt": rendered_system,
            "rendered_user_prompt": rendered_user,
            "ai_response": response,
            "variables_used": list(variables.keys())
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI request failed: {str(e)}")

# ==================== MODULE 5: TIME MACHINE (WOW FACTOR) ====================

@api_router.post("/v1/workflows/{task_id}/rewind")
async def rewind_workflow(
    task_id: str,
    target_step_id: str,
    reason: str,
    current_user: User = Depends(require_admin)
):
    """Rewind workflow execution to a previous step"""
    # Verify task exists
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow_state = task.get("workflow_state", {})
    if not workflow_state.get("step_history"):
        raise HTTPException(status_code=400, detail="No workflow history to rewind")
    
    # Find target step in history
    target_step = None
    target_index = -1
    
    for i, step in enumerate(workflow_state["step_history"]):
        if step["step_id"] == target_step_id:
            target_step = step
            target_index = i
            break
    
    if not target_step:
        raise HTTPException(status_code=400, detail="Target step not found in workflow history")
    
    # Create backup of current state
    backup_state = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "current_state": workflow_state,
        "rewound_by": current_user.id,
        "reason": reason
    }
    
    # Rewind state
    new_workflow_state = {
        "current_step": target_step_id,
        "step_history": workflow_state["step_history"][:target_index + 1],  # Keep history up to target
        "pending_approvals": [],  # Clear pending approvals
        "started_at": workflow_state["started_at"],
        "completed_steps": [s for s in workflow_state.get("completed_steps", []) if s["step_id"] != target_step_id],
        "variables": workflow_state.get("variables", {}),  # Keep variables
        "rewind_history": workflow_state.get("rewind_history", []) + [backup_state]  # Add to rewind history
    }
    
    # Update task
    await db.tasks.update_one(
        {"id": task_id},
        {"$set": {
            "workflow_state": new_workflow_state,
            "status": "in_progress",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    
    # Log the time travel
    await log_audit(current_user.id, "WORKFLOW_REWIND", f"task-{task_id}", {
        "target_step_id": target_step_id,
        "target_step_name": target_step.get("step_name"),
        "reason": reason,
        "steps_rewound": len(workflow_state["step_history"]) - target_index - 1
    })
    
    return {
        "success": True,
        "rewound_to": target_step["step_name"],
        "steps_rewound": len(workflow_state["step_history"]) - target_index - 1,
        "new_status": "in_progress",
        "backup_created": True
    }

@api_router.get("/v1/workflows/{task_id}/rewind-history")
async def get_rewind_history(
    task_id: str,
    current_user: User = Depends(require_admin)
):
    """Get rewind history for a task"""
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    rewind_history = task.get("workflow_state", {}).get("rewind_history", [])
    
    return {
        "task_id": task_id,
        "rewind_history": rewind_history,
        "total_rewinds": len(rewind_history)
    }

# ==================== ENHANCED AUTHENTICATION ENDPOINTS ====================

@api_router.post("/auth/register", response_model=User, status_code=201)
async def register(user_data: UserCreate, request: Request):
    # Check if user exists
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    
    # Create user
    user = User(
        email=user_data.email,
        full_name=user_data.full_name,
        role="user",
        organization_id=user_data.organization_id
    )
    
    user_doc = user.model_dump()
    user_doc["password_hash"] = hash_password(user_data.password)
    
    await db.users.insert_one(user_doc)
    
    # Log audit
    await log_audit(user.id, "USER_REGISTER", f"user-{user.id}", metadata={
        "ip_address": getattr(request.state, "audit_info", {}).get("ip_address"),
        "user_agent": getattr(request.state, "audit_info", {}).get("user_agent")
    })
    
    return user

@api_router.post("/auth/login")
async def login(credentials: UserLogin, request: Request):
    user_doc = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user_doc or not verify_password(credentials.password, user_doc.get("password_hash", "")):
        # Log failed attempt
        await log_audit("anonymous", "LOGIN_FAILED", f"email-{credentials.email}", metadata={
            "ip_address": getattr(request.state, "audit_info", {}).get("ip_address"),
            "user_agent": getattr(request.state, "audit_info", {}).get("user_agent")
        })
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user_doc.get("is_active", True):
        await log_audit(user_doc["id"], "LOGIN_INACTIVE_ACCOUNT", f"user-{user_doc['id']}")
        raise HTTPException(status_code=403, detail="Account is inactive")
    
    token = create_jwt_token(user_doc["id"], user_doc["email"], user_doc["role"])
    
    # Update last login
    await db.users.update_one(
        {"id": user_doc["id"]},
        {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}}
    )
    
    # Log successful login
    await log_audit(user_doc["id"], "LOGIN_SUCCESS", f"user-{user_doc['id']}", metadata={
        "ip_address": getattr(request.state, "audit_info", {}).get("ip_address"),
        "user_agent": getattr(request.state, "audit_info", {}).get("user_agent")
    })
    
    user = User(**user_doc)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }

@api_router.get("/auth/me", response_model=User)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

print("✅ Enterprise API endpoints loaded successfully!")
