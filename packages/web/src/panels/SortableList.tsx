import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { moveSteps } from './listShortcuts';

function SortableItem<T extends { id: string }>({ item, label, handleTestId, children }: {
  item: T; label: (item: T) => string; handleTestId: string; children: (item: T, handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const handle = (
    <button
      type="button" ref={setActivatorNodeRef} data-testid={handleTestId} aria-label={`Move ${label(item)}`}
      className="mt-0.5 cursor-grab touch-none text-muted-foreground" onClick={(e) => e.stopPropagation()}
      {...attributes} {...listeners}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: 'relative' }}>
      {children(item, handle)}
    </li>
  );
}

/** A vertical list whose rows reorder by dragging the handle (pointer or keyboard). `onMove` gets the number of places moved. */
export function SortableList<T extends { id: string }>({ items, label, handleTestId, onMove, children }: {
  items: readonly T[]; label: (item: T) => string; handleTestId: string;
  onMove: (id: string, steps: number) => void; children: (item: T, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((i) => i.id);
  const nameOf = (id: string | number) => {
    const item = items.find((i) => i.id === String(id));
    return item ? label(item) : String(id);
  };
  const position = (id: string | number) => ids.indexOf(String(id)) + 1;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const steps = moveSteps(ids, String(active.id), String(over.id));
    if (steps !== 0) onMove(String(active.id), steps);
  };

  return (
    <DndContext
      sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}`,
          onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over position ${position(over.id)}` : undefined),
          onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} moved to position ${position(over.id)}` : `${nameOf(active.id)} dropped`),
          onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} cancelled`,
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1">
          {items.map((item) => (
            <SortableItem key={item.id} item={item} label={label} handleTestId={handleTestId}>{children}</SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
