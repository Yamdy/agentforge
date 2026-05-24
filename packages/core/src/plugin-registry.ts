import type { PluginDescriptor } from '@primo-ai/sdk';
import type { PluginFactory } from './plugin-manager.js';

export class PluginRegistryImpl {
  private factories = new Map<string, (config?: Record<string, unknown>) => PluginFactory>();

  register(id: string, factory: (config?: Record<string, unknown>) => PluginFactory): void {
    this.factories.set(id, factory);
  }

  resolve(descriptor: PluginDescriptor): (config?: Record<string, unknown>) => PluginFactory {
    if ('id' in descriptor) {
      const factory = this.factories.get(descriptor.id);
      if (!factory) {
        throw new Error(`Plugin "${descriptor.id}" is not registered in the PluginRegistry`);
      }
      return factory;
    }
    if ('module' in descriptor) {
      throw new Error(
        `Module-based plugin resolution is not yet supported (requested: "${descriptor.module}"). ` +
        'Use { id: "..." } for built-in plugins.',
      );
    }
    throw new Error('Invalid PluginDescriptor: must have "id" or "module" property');
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  list(): string[] {
    return [...this.factories.keys()];
  }
}

export const globalPluginRegistry = new PluginRegistryImpl();
