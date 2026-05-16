"""Tool definitions and tier hierarchy.

Tiers:
  0 - page_devops (lowest, always allowed)
  1 - restart_server
  2 - patch_code (highest)
"""
import target_state

TOOL_TIERS = {
    "page_devops": 0,
    "restart_server": 1,
    "patch_code": 2,
}

TOOL_LABELS = {
    "page_devops": "Page DevOps Team",
    "restart_server": "Restart Server",
    "patch_code": "Patch Code",
}


async def execute_tool(tool: str) -> dict:
    if tool == "page_devops":
        return target_state.control_page()
    if tool == "restart_server":
        return target_state.control_restart()
    if tool == "patch_code":
        return target_state.control_patch()
    return {"ok": False, "error": f"unknown tool {tool}"}
