# Katalusis Workflow OS - Data Models (MongoDB)

## Collections Overview

1. **users** - User accounts and profiles
2. **roles** - Role definitions and permissions
3. **tasks** - Individual task items
4. **workflows** - Workflow definitions
5. **workflow_executions** - Workflow run instances
6. **task_imports** - Import history and reports
7. **db_connections** - External database connections
8. **ai_sessions** - AI assistant conversations
9. **audit_logs** - System audit trail
10. **analytics_cache** - Cached analytics data

---

## 1. Users Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "email": "user@example.com",
  "password_hash": "bcrypt-hashed-password",
  "full_name": "John Doe",
  "role_id": "role-uuid",
  "is_active": true,
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z",
  "last_login": "2025-01-15T10:00:00Z",
  "avatar_url": "https://...",
  "preferences": {
    "theme": "light",
    "notifications_enabled": true,
    "default_view": "kanban"
  }
}
```

**Indexes**:
- `email` (unique)
- `role_id`
- `is_active`

---

## 2. Roles Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "name": "Admin",
  "slug": "admin",
  "permissions": [
    "tasks.create",
    "tasks.read",
    "tasks.update",
    "tasks.delete",
    "workflows.manage",
    "users.manage",
    "analytics.view"
  ],
  "description": "Full task and workflow management",
  "created_at": "2025-01-15T10:00:00Z"
}
```

**Default Roles**:
- `super_admin` - Full system access
- `admin` - Workflow and task management
- `user` - Task execution and updates
- `guest` - Read-only access

---

## 3. Tasks Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "title": "Invoice Approval #2198",
  "description": "3-step approval process",
  "status": "new",
  "priority": "high",
  "assignee_id": "user-uuid",
  "creator_id": "user-uuid",
  "workflow_id": "workflow-uuid",
  "due_date": "2025-10-25T23:59:59Z",
  "tags": ["finance", "invoice"],
  "metadata": {
    "invoice_number": "2198",
    "amount": 5000
  },
  "comments": [
    {
      "id": "comment-uuid",
      "user_id": "user-uuid",
      "text": "Approved by finance",
      "created_at": "2025-01-15T10:00:00Z"
    }
  ],
  "attachments": [
    {
      "id": "attachment-uuid",
      "filename": "invoice.pdf",
      "url": "https://...",
      "uploaded_by": "user-uuid",
      "uploaded_at": "2025-01-15T10:00:00Z"
    }
  ],
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z",
  "completed_at": null
}
```

**Enums**:
- Status: `new`, `in_progress`, `on_hold`, `completed`
- Priority: `low`, `medium`, `high`, `critical`

**Indexes**:
- `assignee_id`
- `status`
- `priority`
- `due_date`
- `workflow_id`
- `tags`

---

## 4. Workflows Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "name": "Invoice Approval Process",
  "description": "Standard 3-step invoice approval",
  "creator_id": "user-uuid",
  "is_active": true,
  "is_template": false,
  "nodes": [
    {
      "id": "node-1",
      "type": "task",
      "label": "Finance Review",
      "position": {"x": 100, "y": 100},
      "data": {
        "assignee_role": "finance_team",
        "priority": "high"
      }
    },
    {
      "id": "node-2",
      "type": "condition",
      "label": "Amount > $5000?",
      "position": {"x": 300, "y": 100},
      "data": {
        "condition": "metadata.amount > 5000"
      }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "node-1",
      "target": "node-2",
      "label": "Next"
    }
  ],
  "rules": [
    {
      "id": "rule-1",
      "condition": "priority == 'critical'",
      "action": "notify_admin"
    }
  ],
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

**Indexes**:
- `creator_id`
- `is_active`
- `is_template`

---

## 5. Task Imports Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "filename": "tasks_2025-01-15.csv",
  "uploaded_by": "user-uuid",
  "uploaded_at": "2025-01-15T10:00:00Z",
  "status": "completed",
  "total_rows": 100,
  "imported_count": 97,
  "skipped_count": 3,
  "errors": [
    {
      "row": 5,
      "field": "due_date",
      "error": "Invalid date format",
      "value": "2025-13-01"
    }
  ],
  "report_url": "/api/imports/report-uuid.csv",
  "dry_run": false,
  "created_at": "2025-01-15T10:00:00Z"
}
```

**Indexes**:
- `uploaded_by`
- `uploaded_at`
- `status`

---

## 6. Database Connections Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "name": "Production SQL Server",
  "type": "mssql",
  "host": "sql.example.com",
  "port": 1433,
  "database": "production_db",
  "username": "app_user",
  "password_encrypted": "encrypted-password",
  "is_active": true,
  "created_by": "user-uuid",
  "last_tested": "2025-01-15T10:00:00Z",
  "test_status": "success",
  "created_at": "2025-01-15T10:00:00Z"
}
```

**Indexes**:
- `created_by`
- `is_active`

---

## 7. AI Sessions Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "user_id": "user-uuid",
  "session_id": "session-uuid",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "Create a workflow for invoice approval",
      "timestamp": "2025-01-15T10:00:00Z"
    },
    {
      "id": "msg-2",
      "role": "assistant",
      "content": "I'll create a 3-step approval workflow...",
      "timestamp": "2025-01-15T10:00:05Z"
    }
  ],
  "context": {
    "workflow_id": "workflow-uuid",
    "intent": "workflow_generation"
  },
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:05Z"
}
```

**Indexes**:
- `user_id`
- `session_id`

---

## 8. Audit Logs Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "user_id": "user-uuid",
  "action": "task.update",
  "resource_type": "task",
  "resource_id": "task-uuid",
  "changes": {
    "status": {"old": "new", "new": "in_progress"}
  },
  "ip_address": "192.168.1.1",
  "user_agent": "Mozilla/5.0...",
  "timestamp": "2025-01-15T10:00:00Z"
}
```

**Indexes**:
- `user_id`
- `action`
- `timestamp`
- `resource_id`

---

## 9. Analytics Cache Collection

```json
{
  "_id": "ObjectId",
  "id": "uuid-string",
  "metric_type": "task_completion_rate",
  "period": "daily",
  "date": "2025-01-15",
  "data": {
    "total_tasks": 150,
    "completed_tasks": 135,
    "rate": 90.0
  },
  "calculated_at": "2025-01-15T23:59:59Z"
}
```

**Indexes**:
- `metric_type`
- `period`
- `date`

---

## CSV Import Template Fields

**Required Columns**:
- `Title` (max 150 chars)

**Optional Columns**:
- `Description` (text)
- `AssigneeEmail` (valid email)
- `Priority` (Low|Medium|High|Critical, default: Medium)
- `DueDate` (YYYY-MM-DD)
- `Tags` (comma-separated)
- `Status` (New|In Progress|On Hold|Completed, default: New)

**Validation Rules**:
1. Title is required and must not exceed 150 characters
2. Priority must be one of: Low, Medium, High, Critical
3. Status must be one of: New, In Progress, On Hold, Completed
4. DueDate must be valid ISO date format (YYYY-MM-DD)
5. AssigneeEmail will be matched to existing users
6. Extra columns are ignored but logged in import report

---

## Seed Data

Default roles and one super admin user will be created on first startup:

```python
# Default Super Admin
{
  "email": "admin@katalusis.com",
  "password": "Admin@123",  # Must be changed on first login
  "role": "super_admin"
}
```
