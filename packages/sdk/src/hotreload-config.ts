/**
 * Hot Reload Config Manager
 * Utilities for managing which apps have hot reload enabled
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const ROOT_DIR = path.join(__dirname, '../..');
const CONFIG_PATH = path.join(ROOT_DIR, '.eden-hra.json');

interface HotReloadConfig {
  apps: string[];
}

async function loadConfig(): Promise<HotReloadConfig> {
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { apps: [] };
  }
}

async function saveConfig(config: HotReloadConfig): Promise<void> {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function isHotReloadEnabled(appId: string): Promise<boolean> {
  const config = await loadConfig();
  return config.apps.includes(appId);
}

export async function toggleHotReload(appId: string): Promise<boolean> {
  const config = await loadConfig();
  const index = config.apps.indexOf(appId);
  
  if (index >= 0) {
    // Disable hot reload
    config.apps.splice(index, 1);
    await saveConfig(config);
    return false;
  } else {
    // Enable hot reload
    config.apps.push(appId);
    await saveConfig(config);
    return true;
  }
}

export async function getHotReloadApps(): Promise<string[]> {
  const config = await loadConfig();
  return config.apps;
}
