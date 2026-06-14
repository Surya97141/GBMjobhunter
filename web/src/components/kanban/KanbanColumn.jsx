import { Droppable, Draggable } from '@hello-pangea/dnd';
import KanbanCard from './KanbanCard';
import styles from './KanbanColumn.module.css';

function EmptyState({ title }) {
  return (
    <div className={styles.emptyState} aria-label={`No cards in ${title}`}>
      <span className={styles.emptyText}>{title}</span>
    </div>
  );
}

export default function KanbanColumn({ column, cards }) {
  return (
    <div className={styles.column} aria-label={column.title}>

      <div className={styles.header}>
        <span className={styles.dot} data-column={column.id} aria-hidden="true" />
        <span className={styles.title}>{column.title}</span>
        <span className={styles.count}>{cards.length}</span>
      </div>

      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`${styles.cardList} ${
              snapshot.isDraggingOver ? styles.cardListDraggingOver : ''
            }`}
          >
            {cards.length === 0 && !snapshot.isDraggingOver && (
              <EmptyState title={column.title} />
            )}

            {cards.map((card, index) => (
              <Draggable key={card.id} draggableId={String(card.id)} index={index}>
                {(draggableProvided, draggableSnapshot) => (
                  <KanbanCard
                    card={card}
                    draggableProvided={draggableProvided}
                    isDragging={draggableSnapshot.isDragging}
                  />
                )}
              </Draggable>
            ))}

            {provided.placeholder}
          </div>
        )}
      </Droppable>

    </div>
  );
}
