import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { StreamEvent } from '../types';

// TODO中间件状态
interface TodoState {
  items: string[];
  currentItem?: string;
}

// TODO中间件创建函数
export function createTodoMiddleware(): (
  source$: Observable<StreamEvent>
) => Observable<StreamEvent> {
  const todoState: TodoState = {
    items: [],
    currentItem: undefined,
  };

  return (source$: Observable<StreamEvent>) => {
    return source$.pipe(
      tap((event) => {
        // 处理TODO相关的事件
        switch (event.type) {
          case 'text':
            extractTodosFromText(event.content);
            break;
          case 'tool_call_start':
            if (event.name === 'write_todos' || event.name === 'update_todos') {
              todoState.currentItem = 'writing_todos';
            }
            break;
        }
      })
    );
  };

  function extractTodosFromText(text: string) {
    // 简单的TODO提取逻辑，识别类似 "- [ ] Task" 或 "TODO: Task" 的格式
    const todoPatterns = [
      /- \[ \] (.*)/g, // Markdown checklist
      /- \[x\] (.*)/g, // Completed items
      /TODO: (.*)/g,
    ];

    todoPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (!todoState.items.includes(match[1])) {
          todoState.items.push(match[1]);
          console.log(`[TodoMiddleware] Added TODO: ${match[1]}`);
        }
      }
    });
  }
}
