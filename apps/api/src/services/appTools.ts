import { FastifyInstance } from "fastify";
import { registerTool } from "@specora/sdk";
import { getStateMachineConfig } from "../routes/admin";
import { emit } from "./eventBus";

async function validateStatusTransition(
  pg: any,
  currentStatus: string,
  newStatus: string,
  userRole: string
): Promise<{ valid: boolean; error?: string }> {
  const config = await getStateMachineConfig(pg);
  if (!config) return { valid: true }; // No config = no enforcement

  const transition = config.transitions?.find(
    (t: any) => t.from === currentStatus && t.to === newStatus
  );
  if (!transition) {
    return { valid: false, error: `Invalid transition: ${currentStatus} → ${newStatus}` };
  }
  if (!transition.roles?.includes(userRole)) {
    return { valid: false, error: `Role '${userRole}' cannot perform ${currentStatus} → ${newStatus}` };
  }
  return { valid: true };
}

// ─────────────────────────────────────────────────────────────
// Change Manager tools
// ─────────────────────────────────────────────────────────────

function combineDateTime(date?: string, time?: string): string | null {
  if (!date) return null;
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  return `${date}T${t}:00Z`;
}

registerTool<FastifyInstance>("change-manager", {
  name: "create_rfc",
  description: `Create a change request for a CI.

IMPORTANT: Before calling this tool, collect ALL required information from the user through conversation, ONE QUESTION AT A TIME:
1. Ask which CI they want to change. Use search_cis if they don't know the ID.
2. Use get_affected_cis to discover dependencies (up to 3 hops). Ask which should be included.
3. Collect the title.
4. Collect the description (optional).
5. Collect planned start date (YYYY-MM-DD) and planned start time (HH:MM, optional).
6. Collect planned end date (YYYY-MM-DD) and planned end time (HH:MM, optional).

Only call this tool once all required information is gathered.`,
  parameters: {
    type: "object",
    properties: {
      ciId: { type: "string", description: "ID of the CI to change" },
      title: { type: "string", description: "RFC title" },
      description: { type: "string", description: "Detailed description" },
      plannedStartDate: { type: "string", description: "Planned start date in YYYY-MM-DD format" },
      plannedStartTime: { type: "string", description: "Planned start time in HH:MM format (optional, default 00:00)" },
      plannedEndDate: { type: "string", description: "Planned end date in YYYY-MM-DD format (optional)" },
      plannedEndTime: { type: "string", description: "Planned end time in HH:MM format (optional, default 00:00)" },
      affectedCiIds: { type: "array", items: { type: "string" }, description: "IDs of affected/dependent CIs to include" },
    },
    required: ["ciId", "title"],
  },
}, async (args, fastify) => {
  const { ciId, title, description, plannedStartDate, plannedStartTime, plannedEndDate, plannedEndTime, affectedCiIds, _userId } = args as any;
  const plannedStartAt = combineDateTime(plannedStartDate, plannedStartTime);
  const plannedEndAt = combineDateTime(plannedEndDate, plannedEndTime);
  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO change_requests (ci_id, title, description, status, scheduled_at, planned_start_at, planned_end_at, requester_id)
       VALUES ($1, $2, $3, 'draft', $4, $4, $5, $6) RETURNING id, ci_id, title, status, created_at`,
      [ciId, title, description || null, plannedStartAt, plannedEndAt, _userId || null]
    );
    const rfc = result.rows[0];
    // Insert primary CI
    await client.query(
      `INSERT INTO change_request_cis (change_request_id, ci_id, role) VALUES ($1, $2, 'primary') ON CONFLICT DO NOTHING`,
      [rfc.id, ciId]
    );
    // Insert affected CIs
    const affected = Array.isArray(affectedCiIds) ? affectedCiIds : [];
    for (const affectedCiId of affected) {
      if (affectedCiId === ciId) continue;
      await client.query(
        `INSERT INTO change_request_cis (change_request_id, ci_id, role) VALUES ($1, $2, 'affected') ON CONFLICT DO NOTHING`,
        [rfc.id, affectedCiId]
      );
    }
    await client.query("COMMIT");
    emit("rfc.created", { rfcId: rfc.id, ciId, title, status: "draft", requesterId: _userId });
    return rfc;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

registerTool<FastifyInstance>("change-manager", {
  name: "edit_rfc",
  description: "Edit an existing change request. Only the fields you provide will be updated.",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string", description: "UUID of the RFC to edit" },
      title: { type: "string" },
      description: { type: "string" },
      status: { type: "string", description: "draft, pending_approval, approved, implemented, closed, rejected" },
      plannedStartDate: { type: "string", description: "Planned start date in YYYY-MM-DD format" },
      plannedStartTime: { type: "string", description: "Planned start time in HH:MM format" },
      plannedEndDate: { type: "string", description: "Planned end date in YYYY-MM-DD format" },
      plannedEndTime: { type: "string", description: "Planned end time in HH:MM format" },
      affectedCiIds: { type: "array", items: { type: "string" }, description: "Replace the full list of affected CIs" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId, title, description, status, plannedStartDate, plannedStartTime, plannedEndDate, plannedEndTime, affectedCiIds, _userId, _userRole } = args as any;
  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");

    // Verify RFC exists and user has permission to edit
    const rfcCheck = await client.query("SELECT status, requester_id FROM change_requests WHERE id = $1", [rfcId]);
    if (!rfcCheck.rows.length) {
      await client.query("ROLLBACK");
      return { error: "RFC not found" };
    }
    const rfc = rfcCheck.rows[0];
    if (_userId && rfc.requester_id !== _userId) {
      const userResult = await client.query("SELECT role FROM users WHERE id = $1", [_userId]);
      const userRole = userResult.rows[0]?.role;
      if (userRole !== "admin" && userRole !== "security_admin" && userRole !== "change_manager") {
        await client.query("ROLLBACK");
        return { error: "Only the RFC requester, a change manager, or an admin can edit this RFC." };
      }
    }

    // Validate state machine transition if status is changing
    if (status !== undefined) {
      const currentStatus = rfc.status;
      if (currentStatus !== status) {
        const validation = await validateStatusTransition(client, currentStatus, status, _userRole || "viewer");
        if (!validation.valid) {
          await client.query("ROLLBACK");
          return { error: validation.error };
        }
      }
    }

    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (title !== undefined) { sets.push(`title = $${idx++}`); params.push(title); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
    if (status !== undefined) { sets.push(`status = $${idx++}`); params.push(status); }
    if (plannedStartDate !== undefined) {
      const v = combineDateTime(plannedStartDate, plannedStartTime);
      sets.push(`scheduled_at = $${idx++}`); params.push(v);
      sets.push(`planned_start_at = $${idx++}`); params.push(v);
    }
    if (plannedEndDate !== undefined) {
      const v = combineDateTime(plannedEndDate, plannedEndTime);
      sets.push(`planned_end_at = $${idx++}`); params.push(v);
    }
    if (sets.length === 0) {
      await client.query("ROLLBACK");
      return { error: "No fields to update" };
    }
    sets.push(`updated_at = NOW()`);
    params.push(rfcId);

    const oldStatus = rfc.status;

    const result = await client.query(
      `UPDATE change_requests SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id, ci_id, title, status, updated_at`,
      params
    );
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return { error: "RFC not found" };
    }
    // Update affected CIs if provided
    if (Array.isArray(affectedCiIds)) {
      await client.query(`DELETE FROM change_request_cis WHERE change_request_id = $1 AND role = 'affected'`, [rfcId]);
      const rfcResult = await client.query(`SELECT ci_id FROM change_requests WHERE id = $1`, [rfcId]);
      const primaryCiId = rfcResult.rows[0]?.ci_id;
      for (const ciId of affectedCiIds) {
        if (ciId === primaryCiId) continue;
        await client.query(
          `INSERT INTO change_request_cis (change_request_id, ci_id, role) VALUES ($1, $2, 'affected') ON CONFLICT DO NOTHING`,
          [rfcId, ciId]
        );
      }
    }
    await client.query("COMMIT");
    const updated = result.rows[0];
    emit("rfc.updated", { rfcId, title: updated.title, status: updated.status });
    if (status !== undefined && oldStatus !== status) {
      emit("rfc.status_changed", { rfcId, oldStatus, newStatus: status, actorId: _userId });
    }
    return updated;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

registerTool<FastifyInstance>("change-manager", {
  name: "delete_rfc",
  description: "Delete a change request. Only draft RFCs can be deleted.",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string", description: "UUID of the RFC to delete" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId, _userId } = args as any;
  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");
    const rfcResult = await client.query("SELECT status, requester_id FROM change_requests WHERE id = $1", [rfcId]);
    if (!rfcResult.rows.length) {
      await client.query("ROLLBACK");
      return { error: "RFC not found" };
    }
    const rfc = rfcResult.rows[0];
    if (rfc.status !== "draft") {
      await client.query("ROLLBACK");
      return { error: `Cannot delete RFC with status '${rfc.status}'. Only draft RFCs can be deleted.` };
    }
    // Allow deletions by the requester, admin, or security_admin
    if (_userId && rfc.requester_id !== _userId) {
      const userResult = await client.query("SELECT role FROM users WHERE id = $1", [_userId]);
      const userRole = userResult.rows[0]?.role;
      if (userRole !== "admin" && userRole !== "security_admin") {
        await client.query("ROLLBACK");
        return { error: "Only the RFC requester or an admin can delete this RFC." };
      }
    }
    await client.query("DELETE FROM change_request_cis WHERE change_request_id = $1", [rfcId]);
    await client.query("DELETE FROM change_request_approvers WHERE change_request_id = $1", [rfcId]);
    await client.query("DELETE FROM change_request_comments WHERE change_request_id = $1", [rfcId]);
    await client.query("DELETE FROM change_requests WHERE id = $1", [rfcId]);
    await client.query("COMMIT");
    emit("rfc.deleted", { rfcId, actorId: _userId });
    return { deleted: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

registerTool<FastifyInstance>("change-manager", {
  name: "get_rfc",
  description: "Get basic details of a specific change request",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string", description: "UUID of the RFC" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId } = args as any;
  const result = await fastify.pg.query(
    "SELECT * FROM change_requests WHERE id = $1",
    [rfcId]
  );
  if (!result.rows.length) return { error: "RFC not found" };
  const row = result.rows[0];
  return {
    ...row,
    plannedStartAt: row.planned_start_at || row.scheduled_at,
    plannedEndAt: row.planned_end_at,
  };
});

registerTool<FastifyInstance>("change-manager", {
  name: "get_rfc_details",
  description: "Get full details of a change request including affected CIs, approvers, and comments",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string", description: "UUID of the RFC" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId } = args as any;
  const pg = fastify.pg;
  const rfcResult = await pg.query("SELECT * FROM change_requests WHERE id = $1", [rfcId]);
  if (!rfcResult.rows.length) return { error: "RFC not found" };
  const rfc = rfcResult.rows[0];

  const cisResult = await pg.query(
    `SELECT ci_id, role FROM change_request_cis WHERE change_request_id = $1`,
    [rfcId]
  );
  const approversResult = await pg.query(
    `SELECT a.user_id, a.role, a.approved_at, u.name, u.email
     FROM change_request_approvers a
     JOIN users u ON u.id = a.user_id
     WHERE a.change_request_id = $1`,
    [rfcId]
  );
  const commentsResult = await pg.query(
    `SELECT c.id, c.content, c.created_at, u.name as author
     FROM change_request_comments c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.change_request_id = $1
     ORDER BY c.created_at ASC`,
    [rfcId]
  );

  // Look up CI names from Neo4j
  const session = fastify.neo4j.session();
  let ciNames: Record<string, string> = {};
  try {
    const ciIds = cisResult.rows.map((r: any) => r.ci_id);
    if (ciIds.length > 0) {
      const neoResult = await session.run(
        `MATCH (n:ConfigurationItem) WHERE n.id IN $ids RETURN n.id as id, n.name as name`,
        { ids: ciIds }
      );
      for (const record of neoResult.records) {
        ciNames[record.get("id")] = record.get("name");
      }
    }
  } finally {
    await session.close();
  }

  return {
    ...rfc,
    plannedStartAt: rfc.planned_start_at || rfc.scheduled_at,
    plannedEndAt: rfc.planned_end_at,
    affectedCis: cisResult.rows.map((r: any) => ({ ciId: r.ci_id, role: r.role, name: ciNames[r.ci_id] || r.ci_id })),
    approvers: approversResult.rows,
    comments: commentsResult.rows,
  };
});

registerTool<FastifyInstance>("change-manager", {
  name: "list_rfcs",
  description: "List change requests, optionally filtered by status or CI",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", description: "draft, pending_approval, approved, implemented, closed, rejected" },
      ciId: { type: "string" },
    },
  },
}, async (args, fastify) => {
  const { status, ciId } = args as any;
  let query = "SELECT id, ci_id, title, status, COALESCE(planned_start_at, scheduled_at) as planned_start_at, created_at FROM change_requests WHERE 1=1";
  const params: any[] = [];
  let idx = 1;
  if (status) {
    query += ` AND status = $${idx++}`;
    params.push(status);
  }
  if (ciId) {
    query += ` AND ci_id = $${idx++}`;
    params.push(ciId);
  }
  query += " ORDER BY created_at DESC LIMIT 50";
  const result = await fastify.pg.query(query, params);
  return result.rows;
});

registerTool<FastifyInstance>("change-manager", {
  name: "get_affected_cis",
  description: "Discover CIs affected by a change by traversing the service graph up to 3 hops. Returns upstream and downstream dependencies.",
  parameters: {
    type: "object",
    properties: {
      ciId: { type: "string", description: "ID of the primary CI" },
    },
    required: ["ciId"],
  },
}, async (args, fastify) => {
  const { ciId } = args as any;
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH path = (root:ConfigurationItem {id: $rootId})-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT*1..3]-(related:ConfigurationItem)
       WHERE related.id <> root.id
       WITH related, min(length(path)) as distance
       RETURN related.id as id, related.name as name, related.class as class, related.environment as environment, distance
       ORDER BY distance
       LIMIT 50`,
      { rootId: ciId }
    );
    return result.records.map((r: any) => ({
      id: r.get("id"),
      name: r.get("name"),
      class: r.get("class"),
      environment: r.get("environment"),
      distance: r.get("distance").toNumber(),
    }));
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("change-manager", {
  name: "assign_approvers",
  description: "Assign users as approvers for a change request",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string" },
      userIds: { type: "array", items: { type: "string" }, description: "Array of user UUIDs" },
    },
    required: ["rfcId", "userIds"],
  },
}, async (args, fastify) => {
  const { rfcId, userIds, _userId } = args as any;
  if (!_userId) return { error: "Authentication required" };

  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");
    const rfcResult = await client.query("SELECT requester_id FROM change_requests WHERE id = $1", [rfcId]);
    if (!rfcResult.rows.length) {
      await client.query("ROLLBACK");
      return { error: "RFC not found" };
    }
    const rfc = rfcResult.rows[0];
    if (_userId && rfc.requester_id !== _userId) {
      const userResult = await client.query("SELECT role FROM users WHERE id = $1", [_userId]);
      const userRole = userResult.rows[0]?.role;
      if (userRole !== "admin" && userRole !== "security_admin" && userRole !== "change_manager") {
        await client.query("ROLLBACK");
        return { error: "Only the RFC requester, a change manager, or an admin can assign approvers." };
      }
    }
    for (const userId of userIds) {
      await client.query(
        `INSERT INTO change_request_approvers (change_request_id, user_id, role) VALUES ($1, $2, 'approver') ON CONFLICT DO NOTHING`,
        [rfcId, userId]
      );
    }
    await client.query("COMMIT");
    return { success: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

registerTool<FastifyInstance>("change-manager", {
  name: "approve_rfc",
  description: "Approve a pending change request. The current user must be an assigned approver or have change-manager approval permission. Self-approval is not allowed.",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string", description: "UUID of the RFC" },
      overrideJustification: { type: "string", description: "Required if overriding a risk/conflict block" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId, _userId, _userRole } = args as any;
  if (!_userId) return { error: "Authentication required" };

  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");

    // Fetch RFC
    const rfcResult = await client.query("SELECT * FROM change_requests WHERE id = $1 FOR UPDATE", [rfcId]);
    if (!rfcResult.rows.length) {
      await client.query("ROLLBACK");
      return { error: "RFC not found" };
    }
    const rfc = rfcResult.rows[0];

    // Validate state machine transition
    const validation = await validateStatusTransition(client, rfc.status, "approved", _userRole || "viewer");
    if (!validation.valid) {
      await client.query("ROLLBACK");
      return { error: validation.error };
    }

    // Self-approval block
    if (rfc.requester_id === _userId) {
      await client.query("ROLLBACK");
      return { error: "Self-approval is not permitted. A different user must approve this change." };
    }

    // Check if user is assigned approver
    const approverResult = await client.query(
      "SELECT 1 FROM change_request_approvers WHERE change_request_id = $1 AND user_id = $2",
      [rfcId, _userId]
    );
    const isAssignedApprover = approverResult.rows.length > 0;

    // Check role-based permission
    const { hasPermission } = await import("../services/rbac");
    const hasApprovePermission = await hasPermission(client, {
      role: _userRole || "viewer",
      resource: "change-manager",
      action: "approve",
    });

    if (!isAssignedApprover && !hasApprovePermission) {
      await client.query("ROLLBACK");
      return { error: "You are not authorized to approve this change request" };
    }

    // Record approval
    await client.query(
      `UPDATE change_request_approvers SET approved_at = NOW() WHERE change_request_id = $1 AND user_id = $2`,
      [rfcId, _userId]
    );
    // If not already an approver but has permission, add them
    if (!isAssignedApprover && hasApprovePermission) {
      await client.query(
        `INSERT INTO change_request_approvers (change_request_id, user_id, role, approved_at) VALUES ($1, $2, 'change_manager', NOW()) ON CONFLICT DO NOTHING`,
        [rfcId, _userId]
      );
    }

    // Check if all approvers have approved
    const pendingResult = await client.query(
      `SELECT COUNT(*) as pending FROM change_request_approvers WHERE change_request_id = $1 AND approved_at IS NULL`,
      [rfcId]
    );
    const pendingCount = parseInt(pendingResult.rows[0].pending, 10);

    // If no approvers are assigned, require at least one approval from a change_manager
    const totalApproversResult = await client.query(
      `SELECT COUNT(*) as total FROM change_request_approvers WHERE change_request_id = $1`,
      [rfcId]
    );
    const totalApprovers = parseInt(totalApproversResult.rows[0].total, 10);

    if (pendingCount === 0 && totalApprovers > 0) {
      // All approvers approved — update RFC status
      await client.query(
        `UPDATE change_requests SET status = 'approved', approver_id = $1, updated_at = NOW() WHERE id = $2`,
        [_userId, rfcId]
      );
      await client.query("COMMIT");
      emit("rfc.status_changed", { rfcId, oldStatus: rfc.status, newStatus: "approved", actorId: _userId });
      return { success: true, status: "approved", allApproversApproved: true };
    }

    await client.query("COMMIT");
    emit("rfc.updated", { rfcId, status: rfc.status, pendingApprovals: pendingCount, actorId: _userId });
    return { success: true, status: rfc.status, pendingApprovals: pendingCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

registerTool<FastifyInstance>("change-manager", {
  name: "reject_rfc",
  description: "Reject a change request",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string" },
      reason: { type: "string", description: "Reason for rejection" },
    },
    required: ["rfcId", "reason"],
  },
}, async (args, fastify) => {
  const { rfcId, reason, _userId, _userRole } = args as any;
  if (!_userId) return { error: "Authentication required" };

  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");
    const rfcResult = await client.query("SELECT status, requester_id FROM change_requests WHERE id = $1", [rfcId]);
    if (!rfcResult.rows.length) {
      await client.query("ROLLBACK");
      return { error: "RFC not found" };
    }
    const rfc = rfcResult.rows[0];
    const currentStatus = rfc.status;

    // Authorization: requester, admin, security_admin, or change_manager can reject
    if (_userId && rfc.requester_id !== _userId) {
      const userResult = await client.query("SELECT role FROM users WHERE id = $1", [_userId]);
      const userRole = userResult.rows[0]?.role;
      if (userRole !== "admin" && userRole !== "security_admin" && userRole !== "change_manager") {
        await client.query("ROLLBACK");
        return { error: "Only the RFC requester, a change manager, or an admin can reject this RFC." };
      }
    }

    const validation = await validateStatusTransition(client, currentStatus, "rejected", _userRole || "viewer");
    if (!validation.valid) {
      await client.query("ROLLBACK");
      return { error: validation.error };
    }

    await client.query(
      `UPDATE change_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1`,
      [rfcId]
    );
    await client.query(
      `INSERT INTO change_request_comments (change_request_id, user_id, content) VALUES ($1, $2, $3)`,
      [rfcId, _userId, `Rejected: ${reason}`]
    );
    await client.query("COMMIT");
    emit("rfc.status_changed", { rfcId, oldStatus: currentStatus, newStatus: "rejected", actorId: _userId, reason });
    return { success: true, status: "rejected" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

registerTool<FastifyInstance>("change-manager", {
  name: "add_rfc_comment",
  description: "Add a comment to a change request",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string" },
      content: { type: "string" },
    },
    required: ["rfcId", "content"],
  },
}, async (args, fastify) => {
  const { rfcId, content, _userId } = args as any;
  const result = await fastify.pg.query(
    `INSERT INTO change_request_comments (change_request_id, user_id, content) VALUES ($1, $2, $3) RETURNING id, content, created_at`,
    [rfcId, _userId || null, content]
  );
  return result.rows[0];
});

registerTool<FastifyInstance>("change-manager", {
  name: "list_pending_approvals",
  description: "List RFCs awaiting approval for the current user",
  parameters: {
    type: "object",
    properties: {},
  },
}, async (args, fastify) => {
  const { _userId } = args as any;
  if (!_userId) return { error: "Authentication required" };
  const result = await fastify.pg.query(
    `SELECT cr.* FROM change_requests cr
     JOIN change_request_approvers cra ON cra.change_request_id = cr.id
     WHERE cra.user_id = $1 AND cra.approved_at IS NULL AND cr.status = 'pending_approval'
     ORDER BY cr.created_at DESC`,
    [_userId]
  );
  return result.rows;
});

// ─────────────────────────────────────────────────────────────
// CAB Analysis tools
// ─────────────────────────────────────────────────────────────

registerTool<FastifyInstance>("change-manager", {
  name: "grade_change_rfc",
  description: "Analyze a change request and return structured risk data for AI synthesis. Returns blast radius, criticality, schedule context, and health of affected CIs.",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId } = args as any;
  const pg = fastify.pg;
  const rfcResult = await pg.query("SELECT * FROM change_requests WHERE id = $1", [rfcId]);
  if (!rfcResult.rows.length) return { error: "RFC not found" };
  const rfc = rfcResult.rows[0];

  const cisResult = await pg.query(
    `SELECT ci_id, role FROM change_request_cis WHERE change_request_id = $1`,
    [rfcId]
  );
  const affectedCount = cisResult.rows.length;
  const primaryCi = cisResult.rows.find((r: any) => r.role === "primary")?.ci_id;

  // Check criticality via Neo4j
  const session = fastify.neo4j.session();
  let criticalityData: any = {};
  try {
    if (primaryCi) {
      const result = await session.run(
        `MATCH (n:ConfigurationItem {id: $id}) RETURN n.class as class, n.environment as environment`,
        { id: primaryCi }
      );
      criticalityData = result.records[0]?.toObject() || {};
    }
  } finally {
    await session.close();
  }

  const criticalClasses = ["BusinessService", "Database", "ApplicationService"];
  const isCritical = criticalClasses.includes(criticalityData.class);

  return {
    blastRadius: affectedCount,
    primaryCiClass: criticalityData.class,
    primaryCiEnvironment: criticalityData.environment,
    isCriticalClass: isCritical,
    plannedStartAt: rfc.planned_start_at,
    plannedEndAt: rfc.planned_end_at,
    scheduledAt: rfc.planned_start_at || rfc.scheduled_at,
    hasSchedule: !!(rfc.planned_start_at || rfc.scheduled_at),
    title: rfc.title,
    status: rfc.status,
  };
});

registerTool<FastifyInstance>("change-manager", {
  name: "check_change_conflicts",
  description: "Detect overlapping scheduled changes that share CIs (including dependency-aware conflicts).",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string" },
      windowHours: { type: "integer", description: "Time window in hours to check for overlaps (default 48)" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId, windowHours = 48 } = args as any;
  const pg = fastify.pg;

  const rfcResult = await pg.query("SELECT ci_id, planned_start_at, scheduled_at FROM change_requests WHERE id = $1", [rfcId]);
  if (!rfcResult.rows.length) return { error: "RFC not found" };
  const { ci_id, planned_start_at, scheduled_at } = rfcResult.rows[0];
  const startAt = planned_start_at || scheduled_at;
  if (!startAt) return { conflicts: [], message: "No scheduled date set, cannot check conflicts" };

  // Get all affected CIs for this RFC (primary + dependencies)
  const cisResult = await pg.query(
    `SELECT ci_id FROM change_request_cis WHERE change_request_id = $1`,
    [rfcId]
  );
  const ciIds = cisResult.rows.map((r: any) => r.ci_id);

  // Find other RFCs scheduled within the window that affect any of the same CIs
  const conflictResult = await pg.query(
    `SELECT DISTINCT cr.id, cr.title, cr.ci_id, COALESCE(cr.planned_start_at, cr.scheduled_at) as planned_start_at, cr.status, crc.ci_id as conflicting_ci
     FROM change_requests cr
     JOIN change_request_cis crc ON crc.change_request_id = cr.id
     WHERE cr.id <> $1
       AND COALESCE(cr.planned_start_at, cr.scheduled_at) IS NOT NULL
       AND cr.status NOT IN ('closed', 'rejected', 'rolled_back')
       AND ABS(EXTRACT(EPOCH FROM (COALESCE(cr.planned_start_at, cr.scheduled_at) - $2))) <= $3 * 3600
       AND crc.ci_id = ANY($4)
     ORDER BY COALESCE(cr.planned_start_at, cr.scheduled_at)`,
    [rfcId, startAt, windowHours, ciIds]
  );

  return {
    primaryCi: ci_id,
    plannedStartAt: startAt,
    windowHours,
    conflicts: conflictResult.rows,
    conflictCount: conflictResult.rows.length,
  };
});

registerTool<FastifyInstance>("change-manager", {
  name: "check_ci_health_before_change",
  description: "Check the health of all CIs affected by a change request before approval",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId } = args as any;
  const pg = fastify.pg;
  const cisResult = await pg.query(
    `SELECT ci_id FROM change_request_cis WHERE change_request_id = $1`,
    [rfcId]
  );
  const ciIds = cisResult.rows.map((r: any) => r.ci_id);
  if (ciIds.length === 0) return { healthy: true, ciHealth: [] };

  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem) WHERE n.id IN $ids
       OPTIONAL MATCH (n)-[r]-()
       RETURN n.id as id, n.name as name, n.class as class, count(r) as relCount`,
      { ids: ciIds }
    );
    const ciHealth = result.records.map((r: any) => {
      const relCount = r.get("relCount").toNumber();
      const healthy = relCount > 0;
      return {
        id: r.get("id"),
        name: r.get("name"),
        class: r.get("class"),
        relationshipCount: relCount,
        healthy,
      };
    });
    const allHealthy = ciHealth.every((ci: any) => ci.healthy);
    return { healthy: allHealthy, ciHealth };
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("change-manager", {
  name: "list_recent_changes_for_ci",
  description: "Show recent change requests for a CI (last 90 days)",
  parameters: {
    type: "object",
    properties: {
      ciId: { type: "string" },
    },
    required: ["ciId"],
  },
}, async (args, fastify) => {
  const { ciId } = args as any;
  const result = await fastify.pg.query(
    `SELECT id, title, status, COALESCE(planned_start_at, scheduled_at) as planned_start_at, created_at
     FROM change_requests
     WHERE ci_id = $1 AND created_at > NOW() - INTERVAL '90 days'
     ORDER BY created_at DESC`,
    [ciId]
  );
  return { ciId, recentChanges: result.rows };
});

registerTool<FastifyInstance>("change-manager", {
  name: "summarize_rfc_impact",
  description: "Return structured data about what would be affected if a change fails. The AI uses this to generate a natural language impact summary.",
  parameters: {
    type: "object",
    properties: {
      rfcId: { type: "string" },
    },
    required: ["rfcId"],
  },
}, async (args, fastify) => {
  const { rfcId } = args as any;
  const pg = fastify.pg;
  const cisResult = await pg.query(
    `SELECT ci_id, role FROM change_request_cis WHERE change_request_id = $1`,
    [rfcId]
  );
  const primaryCi = cisResult.rows.find((r: any) => r.role === "primary")?.ci_id;
  const affected = cisResult.rows.filter((r: any) => r.role !== "primary");

  // Get dependency paths from primary to affected
  const session = fastify.neo4j.session();
  let dependencyPaths: any[] = [];
  try {
    if (primaryCi && affected.length > 0) {
      const affectedIds = affected.map((r: any) => r.ci_id);
      const result = await session.run(
        `MATCH path = shortestPath((root:ConfigurationItem {id: $rootId})-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY*1..5]-(affected:ConfigurationItem))
         WHERE affected.id IN $affectedIds
         RETURN affected.id as affectedId, affected.name as affectedName, root.name as rootName, length(path) as hops`,
        { rootId: primaryCi, affectedIds }
      );
      dependencyPaths = result.records.map((r: any) => ({
        affectedId: r.get("affectedId"),
        affectedName: r.get("affectedName"),
        rootName: r.get("rootName"),
        hops: r.get("hops").toNumber(),
      }));
    }
  } finally {
    await session.close();
  }

  return {
    primaryCi,
    affectedCount: affected.length,
    dependencyPaths,
  };
});

// Register Discovery Insights tools
registerTool<FastifyInstance>("discovery-insights", {
  name: "analyze_coverage",
  description: "Analyze a discovery job's coverage against expected CSDMv5 classes",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "UUID of the discovery job" },
    },
    required: ["jobId"],
  },
}, async (args, fastify) => {
  const { jobId } = args as any;
  const logsResult = await fastify.pg.query(
    `SELECT ci_id, action, new_values->>'class' as class FROM reconciliation_logs WHERE discovery_job_id = $1`,
    [jobId]
  );
  const classCounts: Record<string, number> = {};
  for (const row of logsResult.rows) {
    const cls = row.class || "Unknown";
    classCounts[cls] = (classCounts[cls] || 0) + 1;
  }
  return { jobId, classCounts, total: logsResult.rows.length };
});

registerTool<FastifyInstance>("discovery-insights", {
  name: "suggest_next_scan",
  description: "Suggest the next discovery scan based on coverage gaps",
  parameters: {
    type: "object",
    properties: {
      environment: { type: "string", description: "Optional environment filter" },
    },
  },
}, async (args, fastify) => {
  const { environment } = args as any;
  const session = fastify.neo4j.session();
  try {
    let query = "MATCH (n:ConfigurationItem) RETURN n.class as class, count(n) as count";
    const params: any = {};
    if (environment) {
      query = "MATCH (n:ConfigurationItem {environment: $env}) RETURN n.class as class, count(n) as count";
      params.env = environment;
    }
    const result = await session.run(query, params);
    const existing: Record<string, number> = {};
    for (const record of result.records) {
      existing[record.get("class")] = record.get("count").toNumber();
    }
    const expected = ["Server", "Database", "Application", "NetworkGear", "BusinessService", "ApplicationService", "TechnicalService"];
    const gaps = expected.filter((cls) => !existing[cls] || existing[cls] === 0);
    return { gaps, existing, suggestion: gaps.length > 0 ? `Missing: ${gaps.join(", ")}` : "Coverage looks good" };
  } finally {
    await session.close();
  }
});

// Register Health Monitor tools
registerTool<FastifyInstance>("health-monitor", {
  name: "find_cycles",
  description: "Find circular dependencies in the CMDB graph",
  parameters: {
    type: "object",
    properties: {
      maxDepth: { type: "integer", description: "Maximum path depth to search" },
    },
  },
}, async (args, fastify) => {
  const maxDepth = (args.maxDepth as number) || 5;
  if (!Number.isInteger(maxDepth) || maxDepth < 2 || maxDepth > 50) {
    throw new Error("maxDepth must be an integer between 2 and 50");
  }
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH path = (a)-[:DEPENDS_ON|PART_OF*2..${maxDepth}]->(a)
       UNWIND nodes(path) as node
       WITH path, collect(DISTINCT node) as cycleNodes
       RETURN cycleNodes, relationships(path) as rels
       LIMIT 20`
    );
    return result.records.map((r: any) => {
      const nodes = r.get("cycleNodes").map((n: any) => ({
        id: n.properties.id,
        name: n.properties.name,
        class: n.properties.class,
      }));
      const rels = r.get("rels").map((rel: any) => ({
        type: rel.type,
        sourceId: rel.start.properties.id,
        targetId: rel.end.properties.id,
      }));
      return { nodes, relationships: rels };
    });
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("health-monitor", {
  name: "find_orphaned",
  description: "Find CIs with zero relationships",
  parameters: {
    type: "object",
    properties: {
      class: { type: "string", description: "Optional CI class filter" },
    },
  },
}, async (args, fastify) => {
  const cls = args.class as string | undefined;
  const session = fastify.neo4j.session();
  try {
    let query = "MATCH (n:ConfigurationItem) WHERE NOT (n)-[:PART_OF|DEPENDS_ON|HOSTED_ON|MANAGED_BY|OWNED_BY|LOCATED_AT]-()";
    const params: any = {};
    if (cls) {
      query += " AND n.class = $class";
      params.class = cls;
    }
    query += " RETURN n LIMIT 50";
    const result = await session.run(query, params);
    return result.records.map((r: any) => {
      const props = r.get("n").properties;
      return { id: props.id, name: props.name, class: props.class, environment: props.environment };
    });
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("health-monitor", {
  name: "find_stale",
  description: "Find CIs not discovered in the last N days",
  parameters: {
    type: "object",
    properties: {
      days: { type: "integer", description: "Days since last discovery (default 30)" },
    },
  },
}, async (args, fastify) => {
  const days = (args.days as number) || 30;
  const cutoff = Date.now() - days * 86400000;
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem)
       WHERE n.lastDiscoveredAt IS NULL OR n.lastDiscoveredAt < $cutoff
       RETURN n LIMIT 50`,
      { cutoff }
    );
    return result.records.map((r: any) => {
      const props = r.get("n").properties;
      return { id: props.id, name: props.name, class: props.class, environment: props.environment };
    });
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("health-monitor", {
  name: "score_ci",
  description: "Compute health score for a specific CI",
  parameters: {
    type: "object",
    properties: {
      ciId: { type: "string", description: "ID of the CI" },
    },
    required: ["ciId"],
  },
}, async (args, fastify) => {
  const { ciId } = args as any;
  const session = fastify.neo4j.session();
  try {
    const result = await session.run(
      `MATCH (n:ConfigurationItem {id: $id})
       OPTIONAL MATCH (n)-[r]-()
       RETURN n, count(r) as relCount`,
      { id: ciId }
    );
    if (!result.records.length) return { error: "CI not found" };
    const props = result.records[0].get("n").properties;
    const relCount = result.records[0].get("relCount").toNumber();
    const completeness = props.name && props.class && props.environment ? 100 : 60;
    const relationshipValidity = relCount > 0 ? 100 : 0;
    const freshness = props.lastDiscoveredAt ? 100 : 0;
    const overall = Math.round((completeness + relationshipValidity + freshness) / 3);
    return {
      ciId,
      name: props.name,
      class: props.class,
      scores: { completeness, relationshipValidity, freshness, overall },
      relationshipCount: relCount,
    };
  } finally {
    await session.close();
  }
});

registerTool<FastifyInstance>("health-monitor", {
  name: "check_completeness",
  description: "Run hardcoded synthetic completeness rules against the CMDB graph. Returns structural violations like missing relationships.",
  parameters: {
    type: "object",
    properties: {
      ruleId: { type: "string", description: "Optional: run only a specific rule by ID. Leave empty to run all." },
    },
  },
}, async (args, fastify) => {
  const { runHardcodedRules, HARDCODED_RULES } = await import("./healthRules");
  if (args.ruleId) {
    const rule = HARDCODED_RULES.find((r) => r.id === args.ruleId);
    if (!rule) return { error: "Rule not found" };
    const session = fastify.neo4j.session();
    try {
      const result = await session.run(rule.cypher);
      return result.records.map((r: any) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        message: rule.description,
        ciId: r.get("ciId"),
        ciName: r.get("ciName"),
        ciClass: r.get("ciClass"),
      }));
    } finally {
      await session.close();
    }
  }
  return runHardcodedRules(fastify);
});

registerTool<FastifyInstance>("health-monitor", {
  name: "generate_rules",
  description: "Use AI to analyze the current CMDB graph and suggest new structural validation rules. Returns suggested Cypher queries.",
  parameters: {
    type: "object",
    properties: {},
  },
}, async (_args, fastify) => {
  const { generateRules } = await import("./aiRuleGenerator");
  return generateRules(fastify);
});

registerTool<FastifyInstance>("health-monitor", {
  name: "execute_generated_rule",
  description: "Execute a Cypher query generated by the AI rule generator against the CMDB. Safety-guarded: only MATCH queries allowed.",
  parameters: {
    type: "object",
    properties: {
      cypher: { type: "string", description: "The Cypher query to execute. Must start with MATCH." },
    },
    required: ["cypher"],
  },
}, async (args, fastify) => {
  const { executeGeneratedRule } = await import("./aiRuleGenerator");
  return executeGeneratedRule(fastify, args.cypher as string);
});

export function getAllAppToolDefinitions() {
  const { getToolsForSession } = require("@specora/sdk");
  return getToolsForSession("system");
}
