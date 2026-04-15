/**
 * Team ID extraction from server naming conventions.
 *
 * Known patterns (observed in production):
 *   claw-machine-t<TEAM>-u<USER>  → team_id = TEAM
 *   anything else (e.g. "virginia-1") → team_id = server_id (self)
 */

export interface ExtractedTeam {
  team_id: string
  user_id: string | null
}

const CLAW_MACHINE_RE = /^claw-machine-t(\d+)-u(\d+)$/

export function extractTeam(serverId: string): ExtractedTeam {
  const m = serverId.match(CLAW_MACHINE_RE)
  if (m) {
    return { team_id: m[1], user_id: m[2] }
  }
  return { team_id: serverId, user_id: null }
}
