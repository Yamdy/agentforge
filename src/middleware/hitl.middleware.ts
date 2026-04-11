import { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { StreamEvent } from '../types';

export interface HitlConfig {
  tools?: string[];
  allTools?: boolean;
  prompt?: string;
}

export function createHitlMiddleware(
  config: HitlConfig = {}
): (source$: Observable<StreamEvent>) => Observable<StreamEvent> {
  return (source$) => {
    return source$.pipe(
      switchMap(async (event) => {
        if (event.type === 'tool_call_start' && shouldIntercept(event.name)) {
          return handleToolApproval(event);
        }
        return [event];
      }),
      switchMap((events) => events)
    );

    function shouldIntercept(toolName: string): boolean {
      if (config.allTools) {
        return true;
      }
      return config.tools?.includes(toolName) ?? false;
    }

    async function handleToolApproval(
      event: Extract<StreamEvent, { type: 'tool_call_start' }>
    ): Promise<StreamEvent[]> {
      const prompt =
        config.prompt || `Do you want to approve the execution of tool: ${event.name}?`;

      const approval = await requestUserApproval(prompt);

      if (approval) {
        return [event];
      } else {
        return [
          {
            type: 'tool_call_end',
            id: event.id,
            result: 'Execution rejected by user',
          },
        ];
      }
    }

    async function requestUserApproval(prompt: string): Promise<boolean> {
      const autoApprove = process.env.HITL_AUTO_APPROVE === 'true';

      if (autoApprove) {
        console.log(`\n${prompt}`);
        console.log('(Auto-approved: HITL_AUTO_APPROVE=true)');
        return true;
      }

      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'HITL approval requires a real user interaction mechanism in production. ' +
          'Set HITL_AUTO_APPROVE=true for development only.'
        );
      }

      console.log(`\n${prompt}`);
      console.log('(Enter "y" to approve, "n" to reject)');

      return new Promise((resolve) => {
        setTimeout(() => {
          console.log('(Auto-approving for development purposes)');
          resolve(true);
        }, 1000);
      });
    }
  };
}
