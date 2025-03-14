// Define custom YAML types
const includeType = new jsyaml.Type('!include', {
  kind: 'scalar',
  construct: function(data) {
    return data;
  }
});

const secretType = new jsyaml.Type('!secret', {
  kind: 'scalar',
  construct: function(data) {
    return data;
  }
});

// Create schema with custom types
const CUSTOM_SCHEMA = jsyaml.DEFAULT_SCHEMA.extend([includeType, secretType]);

/**
 * Validates a YAML string for specific conditions
 * @param {string} yamlString - The YAML string to validate
 * @returns {Object} Object containing validation flags
 */
export function validateYaml(yamlString) {
  const result = {
    hasInclude: false,
    hasExternalComponents: false,
    hasWifi: false,
    wifiValid: true,
    parseError: null
  };

  try {
    // Parse YAML with custom schema
    const doc = jsyaml.load(yamlString, { schema: CUSTOM_SCHEMA });

    // Check for !include usage by searching the raw string
    result.hasInclude = yamlString.includes('!include');

    // Check for external_components
    result.hasExternalComponents = doc && 'external_components' in doc;

    // Validate wifi configuration if present
    if (doc && 'wifi' in doc) {
      result.hasWifi = true;
      const wifi = doc.wifi;
      
      // Check if wifi contains only ssid and password
      const wifiKeys = Object.keys(wifi || {});
      const hasValidKeys = wifiKeys.length === 2 && 
                          wifiKeys.includes('ssid') && 
                          wifiKeys.includes('password');
      
      // Check if both ssid and password use !secret
      const rawWifiSection = yamlString
        .substring(yamlString.indexOf('wifi:'))
        .split('\n')
        .filter(line => line.includes('wifi:') || 
                       line.includes('ssid:') || 
                       line.includes('password:'))
        .join('\n');
      
      const hasSecretTags = rawWifiSection.includes('!secret') &&
                           (rawWifiSection.match(/!secret/g) || []).length === 2;
      
      result.wifiValid = hasValidKeys && hasSecretTags;
    }

  } catch (error) {
    result.parseError = error.message;
  }

  return result;
}
