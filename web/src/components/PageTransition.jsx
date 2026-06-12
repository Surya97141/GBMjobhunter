import { motion, useReducedMotion } from 'framer-motion';

const variants = {
  initial: { y: 16, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit:    { y: -8, opacity: 0 },
};

const reducedVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
};

export default function PageTransition({ children }) {
  const prefersReduced = useReducedMotion();
  const v = prefersReduced ? reducedVariants : variants;

  return (
    <motion.div
      variants={v}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      style={{ minHeight: '100vh' }}
    >
      {children}
    </motion.div>
  );
}
