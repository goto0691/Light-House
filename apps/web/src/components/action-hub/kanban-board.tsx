import { KanbanColumn } from "@/components/action-hub/kanban-column";
import type { TaskMock } from "@/lib/mock/action-hub";

const COLUMNS = [
  { key: "todo", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
  { key: "blocked", label: "Blocked" },
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
          <KanbanColumn key={column.key} status={column.key} tasks={items} title={column.label}>
            {items.map((task) => (
              <div key={task.id}>{renderTask(task)}</div>
            ))}
          </KanbanColumn>
        );
      })}
    </div>
  );
}

