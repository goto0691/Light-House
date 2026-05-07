import { KanbanColumn } from "@/components/action-hub/kanban-column";
import type { TaskMock } from "@/lib/mock/action-hub";

const COLUMNS = [
  { key: "todo", label: "예정" },
  { key: "in_progress", label: "진행 중" },
  { key: "review", label: "검토" },
  { key: "done", label: "완료" },
  { key: "blocked", label: "막힘" },
] as const;

type KanbanBoardProps = {
  tasks: TaskMock[];
  renderTask: (task: TaskMock) => React.ReactNode;
};

export function KanbanBoard({ tasks, renderTask }: KanbanBoardProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      {COLUMNS.map((column) => {
        const items = tasks.filter((task) => task.status === column.key);
        return (
          <KanbanColumn key={column.key} tasks={items} title={column.label}>
            {items.map((task) => (
              <div key={task.id}>{renderTask(task)}</div>
            ))}
          </KanbanColumn>
        );
      })}
    </div>
  );
}
