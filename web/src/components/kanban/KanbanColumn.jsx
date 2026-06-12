import { Droppable, Draggable } from '@hello-pangea/dnd';
import KanbanCard from './KanbanCard';
import styles from './KanbanColumn.module.css';

export default function KanbanColumn({ column, cards }) {
  return (
    <div className={styles.column} aria-label={column.title}>

      <div className={styles.header}>
        <span
          className={styles.dot}
          data-column={column.id}
          aria-hidden="true"
        />
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
            {cards.map((card, index) => (
              <Draggable key={card.id} draggableId={card.id} index={index}>
                {(draggableProvided, draggableSnapshot) => (
                  <KanbanCard
                    card={card}
                    draggableProvided={draggableProvided}
                    isDragging={draggableSnapshot.isDragging}
                  />
                )}
              </Draggable>
            ))}
            {/* Placeholder maintains column height while a card is being dragged out */}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

    </div>
  );
}
