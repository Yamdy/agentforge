import { Observable, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { StreamEvent } from '../types';
import { createLogger } from '../logger/index.js';

const log = createLogger('todo');

interface TodoState {
  items: string[];
  currentItem?: string;
}

export interface TodoItem {
  text: string;
  addedAt: Date;
}

const todoSubject = new Subject<TodoItem>();

export function getTodoObservable() {
  return todoSubject.asObservable();
}

export function getCurrentTodos(): string[] {
  return [...todoState.items];
}

const todoState: TodoState = {
  items: [],
  currentItem: undefined,
};

export function createTodoMiddleware(): (
  source$: Observable<StreamEvent>
) => Observable<StreamEvent> {
  return (source$: Observable<StreamEvent>) => {
    return source$.pipe(
      tap((event) => {
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
}

function extractTodosFromText(text: string) {
  const todoPatterns = [
    /- \[ \] (.*)/g,
    /- \[x\] (.*)/g,
    /TODO: (.*)/g,
  ];

  todoPatterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (!todoState.items.includes(match[1])) {
        todoState.items.push(match[1]);
        const item: TodoItem = { text: match[1], addedAt: new Date() };
        todoSubject.next(item);
        log.info('Added TODO', { text: match[1] });
      }
    }
  });
}
