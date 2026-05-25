import type { Processor, ProcessorDescriptor, ProcessorDeps, ProcessorFactory, StageName } from '@primo-ai/sdk';

export class ProcessorRegistryImpl {
  private factories = new Map<string, ProcessorFactory>();
  private lazyFactories = new Map<string, ProcessorFactory>();

  register(name: string, factory: ProcessorFactory): void {
    this.factories.set(name, factory);
  }

  registerLazy(name: string, factory: ProcessorFactory): void {
    this.lazyFactories.set(name, factory);
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

  resolveLazy(descriptor: ProcessorDescriptor, deps?: ProcessorDeps): Processor {
    if ('builtin' in descriptor) {
      // Prefer lazy registration over eager registration
      const factory = this.lazyFactories.get(descriptor.builtin) ?? this.factories.get(descriptor.builtin);
      if (!factory) {
        throw new Error(`Processor "${descriptor.builtin}" is not registered in the ProcessorRegistry`);
      }
      let cached: Processor | null = null;
      const stageName = descriptor.builtin as StageName;
      return {
        get stage(): StageName {
          return stageName;
        },
        set stage(_v: StageName) {
          // no-op for lazy processor; actual processor sets its own stage
        },
        async execute(ctx) {
          if (!cached) {
            cached = factory(deps);
            cached.stage = stageName;
          }
          return cached.execute(ctx);
        },
      };
    }
    // Fall through to eager resolve for module descriptors
    return this.resolve(descriptor, deps);
  }

  has(name: string): boolean {
    return this.factories.has(name) || this.lazyFactories.has(name);
  }

  list(): string[] {
    return [...new Set([...this.factories.keys(), ...this.lazyFactories.keys()])];
  }
}

export const globalProcessorRegistry = new ProcessorRegistryImpl();
