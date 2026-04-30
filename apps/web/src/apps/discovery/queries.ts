export const DISCOVERY_QUERY = `query DiscoveryBuilderData {
  discoverySources { id name type config credentialRef lastTestedAt lastStatus lastError createdAt updatedAt }
  discoveryJobs { id sourceId filePath status stats createdAt updatedAt }
}`;

export const CLASSES_QUERY = `query DiscoveryClassData {
  ciClasses {
    name
    displayName
    attributes { name isMandatory isKeyAttribute }
  }
}`;

export const CREATE_SOURCE = `mutation CreateDiscoverySource($name: String!, $type: String!, $config: JSON) {
  createDiscoverySource(name: $name, type: $type, config: $config) { id name type config credentialRef lastTestedAt lastStatus lastError createdAt updatedAt }
}`;

export const UPDATE_SOURCE = `mutation UpdateDiscoverySource($id: ID!, $name: String!, $type: String!, $config: JSON) {
  updateDiscoverySource(id: $id, name: $name, type: $type, config: $config) { id name type config credentialRef lastTestedAt lastStatus lastError createdAt updatedAt }
}`;

export const DELETE_SOURCE = `mutation DeleteDiscoverySource($id: ID!) {
  deleteDiscoverySource(id: $id)
}`;

