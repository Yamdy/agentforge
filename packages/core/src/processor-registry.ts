import type { Processor, ProcessorDescriptor, ProcessorDeps, ProcessorFactory } from '@primo-ai/sdk';

export class ProcessorRegistryImpl {
  private factories = new Map<string, ProcessorFactory>();

  register(name: string, factory: ProcessorFactory): void {
    this.factories.set(name, factory);
  }

  resolve(descriptor: ProcessorDescriptor, deps?: ProcessorDeps): Processor {
    if ('builtin' in descriptor) {
      const factory = this.factories.get(descriptor.builtin);
      if (!factory) {
        throw new Error(`Processor "${descriptor.builtin}" is not registered in the ProcessorRegistry`);
      }
      return factory(deps);
    }
    if ('module' in descriptor) {
      throw new Error(
        `Module-based processor resolution is not yet supported (requested: "${descriptor.module}"). ` +
        'Use { builtin: "..." } for built-in processors.',
      );
    }
    throw new Error('Invalid ProcessorDescriptor: must have "builtin" or "module" property');
  }

  has(name: string): boolean {
    return this.factories.has(name);
  }

  list(): string[] {
    return [...this.factories.keys()];
  }
}

export const globalProcessorRegistry = new ProcessorRegistryImpl();
