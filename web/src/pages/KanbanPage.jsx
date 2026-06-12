import { useState } from 'react';
import { DragDropContext } from '@hello-pangea/dnd';
import KanbanColumn from '../components/kanban/KanbanColumn';
import { Display, Body } from '../components/Typography';
import styles from './KanbanPage.module.css';

// ─── INITIAL BOARD STATE ──────────────────────────────────────────────────────

const INITIAL_CARDS = {
  'app-1': { id: 'app-1', company: 'Stripe',   role: 'Senior Frontend Engineer',       atsScore: 87, date: 'Mar 18' },
  'app-2': { id: 'app-2', company: 'Linear',   role: 'Product Engineer',               atsScore: 91, date: 'Mar 15' },
  'app-3': { id: 'app-3', company: 'Vercel',   role: 'Developer Experience Engineer',  atsScore: 74, date: 'Mar 12' },
  'app-4': { id: 'app-4', company: 'Figma',    role: 'Senior Software Engineer',       atsScore: 82, date: 'Mar 9'  },
  'app-5': { id: 'app-5', company: 'Notion',   role: 'Full Stack Engineer',            atsScore: 79, date: 'Mar 7'  },
  'app-6': { id: 'app-6', company: 'Loom',     role: 'Frontend Engineer',              atsScore: 88, date: 'Mar 5'  },
  'app-7': { id: 'app-7', company: 'Fly.io',   role: 'Platform Engineer',              atsScore: 77, date: 'Mar 3'  },
};

const INITIAL_COLUMNS = {
  applied: {
    id: 'applied',
    title: 'Applied',
    cardIds: ['app-2', 'app-5', 'app-7'],
  },
  interviewing: {
    id: 'interviewing',
    title: 'Interviewing',
    cardIds: ['app-1', 'app-6'],
  },
  offer: {
    id: 'offer',
    title: 'Offer',
    cardIds: [],
  },
  rejected: {
    id: 'rejected',
    title: 'Rejected',
    cardIds: ['app-3', 'app-4'],
  },
};

const COLUMN_ORDER = ['applied', 'interviewing', 'offer', 'rejected'];

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function KanbanPage() {
  const [columns, setColumns] = useState(INITIAL_COLUMNS);

  function handleDragEnd({ draggableId, source, destination }) {
    // Dropped outside a column
    if (!destination) return;

    // Dropped in the same position
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) return;

    const sourceCol = columns[source.droppableId];
    const destCol   = columns[destination.droppableId];

    if (sourceCol.id === destCol.id) {
      // Reorder within the same column
      const newIds = Array.from(sourceCol.cardIds);
      newIds.splice(source.index, 1);
      newIds.splice(destination.index, 0, draggableId);

      setColumns(prev => ({
        ...prev,
        [sourceCol.id]: { ...sourceCol, cardIds: newIds },
      }));
    } else {
      // Move between columns
      const sourceIds = Array.from(sourceCol.cardIds);
      sourceIds.splice(source.index, 1);

      const destIds = Array.from(destCol.cardIds);
      destIds.splice(destination.index, 0, draggableId);

      setColumns(prev => ({
        ...prev,
        [sourceCol.id]: { ...sourceCol, cardIds: sourceIds },
        [destCol.id]:   { ...destCol,   cardIds: destIds  },
      }));
    }
  }

  return (
    <main className={styles.content}>

      <header className={styles.pageHeader}>
        <Display as="h1">Applications</Display>
        <Body color="secondary">Drag cards to update their stage.</Body>
      </header>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className={styles.board} role="list" aria-label="Application kanban board">
          {COLUMN_ORDER.map((colId) => {
            const column = columns[colId];
            const cards  = column.cardIds.map(id => INITIAL_CARDS[id]);
            return (
              <KanbanColumn key={colId} column={column} cards={cards} />
            );
          })}
        </div>
      </DragDropContext>

    </main>
  );
}
