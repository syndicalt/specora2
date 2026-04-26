import { registerChangeManagerTools } from "./appTools/changeManager";
import { registerIncidentManagerTools } from "./appTools/incidentManager";
import { registerKnowledgeCoreTools } from "./appTools/knowledgeCore";
import { registerPreventionCenterTools } from "./appTools/preventionCenter";
import { registerAssetCommandTools } from "./appTools/assetCommand";
import { registerDiscoveryInsightsTools } from "./appTools/discoveryInsights";
import { registerHealthMonitorTools } from "./appTools/healthMonitor";

export function registerAllAppTools() {
  registerChangeManagerTools();
  registerIncidentManagerTools();
  registerKnowledgeCoreTools();
  registerPreventionCenterTools();
  registerAssetCommandTools();
  registerDiscoveryInsightsTools();
  registerHealthMonitorTools();
}

export function getAllAppToolDefinitions() {
  const { getToolsForSession } = require("@specora/sdk");
  return getToolsForSession("system");
}
