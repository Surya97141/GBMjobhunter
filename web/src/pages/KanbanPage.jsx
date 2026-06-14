import { useState, useEffect } from 'react';
import { DragDropContext } from '@hello-pangea/dnd';
import client from '../api/client';
import KanbanColumn from '../components/kanban/KanbanColumn';
import { Display, Body } from '../components/Typography';
import styles from './KanbanPage.module.css';

// Column definitions — id matches the outcome value stored in the database.
const COLUMNS = [
  { id: 'pending',   title: 'Applied'   },
  { id: 'interview', title: 'Interview' },
  { id: 'offer',     title: 'Offer'     },
  { id: 'rejected',  title: 'Rejected'  },
  { id: 'ghosted',   title: 'Ghosted'   },
];

// Group a flat applications array into { [outcome]: app[] }.
function groupByOutcome(apps) {
  const map = {};
  COLUMNS.forEach(col => { map[col.id] = []; });
  apps.forEach(app => {
    const key = map[app.outcome] !== undefined ? app.outcome : 'pending';
    map[key].push(app);
  });
  return map;
}

export default function KanbanPage() {
  const [cards, setCards]     = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    client.get('/applications')
      .then(res => setCards(groupByOutcome(res.data.data.applications)))
      .catch(() => setError('Could not load applications.'))
      .finally(() => setLoading(false));
  }, []);

  async function onDragEnd(result) {
    const { source, destination, draggableId } = result;

    if (!destination) return;
    if (destination.droppableId === source.droppableId &&
        destination.index       === source.index) return;

    const srcCol  = source.droppableId;
    const destCol = destination.droppableId;

    // Optimistic update — move card in local state immediately.
    const srcCards  = Array.from(cards[srcCol]);
    const destCards = srcCol === destCol ? srcCards : Array.from(cards[destCol]);
    const [moved]   = srcCards.splice(source.index, 1);
    destCards.splice(destination.index, 0, { ...moved, outcome: destCol });

    setCards(prev => ({
      ...prev,
      [srcCol]:  srcCards,
      [destCol]: destCards,
    }));

    // Persist to backend.
    try {
      await client.put(`/applications/${draggableId}/outcome`, { outcome: destCol });
    } catch {
      // Revert if API call fails.
      setCards(prev => {
        const revertSrc  = Array.from(prev[srcCol]);
        const revertDest = srcCol === destCol ? revertSrc : Array.from(prev[destCol]);
        revertDest.splice(destination.index, 1);
        revertSrc.splice(source.index, 0, moved);
        return { ...prev, [srcCol]: revertSrc, [destCol]: revertDest };
      });
    }
  }

  if (loading) {
    return (
      <main className={styles.content}>
        <div className={styles.state}>
          <Body color="secondary">Loading applications…</Body>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className={styles.content}>
        <div className={styles.state}>
          <Body color="secondary">{error}</Body>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.content}>

      <header className={styles.pageHeader}>
        <Display as="h1">Applications</Display>
        <Body color="secondary">Drag cards to update their stage.</Body>
      </header>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className={styles.board} role="list" aria-label="Application kanban board">
          {COLUMNS.map(col => (
            <KanbanColumn
              key={col.id}
              column={col}
              cards={cards[col.id] ?? []}
            />
          ))}
        </div>
      </DragDropContext>

    </main>
  );
}
