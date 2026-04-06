import { Observable } from 'rxjs';
import { tap, switchMap, filter } from 'rxjs/operators';
import { StreamEvent } from '../types';

// HITL配置类型
export interface HitlConfig {
  // 需要人工批准的工具名称列表
  tools?: string[];
  // 是否对所有工具都需要批准
  allTools?: boolean;
  // 提示信息
  prompt?: string;
}

// HITL中间件创建函数
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
      // 展平数组
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

      // 模拟用户输入，实际应该替换为真实的用户交互
      const approval = await simulateUserApproval(prompt);

      if (approval) {
        return [event]; // 批准继续执行
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

    async function simulateUserApproval(prompt: string): Promise<boolean> {
      // 这是一个模拟，实际应该实现为真实的用户交互
      console.log(`\n${prompt}`);
      console.log('(Enter "y" to approve, "n" to reject)');

      return new Promise((resolve) => {
        // 模拟用户输入，默认批准
        setTimeout(() => {
          console.log('(Auto-approving for test purposes)');
          resolve(true);
        }, 1000);
      });
    }
  };
}
