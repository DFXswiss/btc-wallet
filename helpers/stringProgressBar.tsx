export const getProgressStringGenerator = (steps: number) => {
  let curr = 0;
  const initialMessage = `${'□ '.repeat(10)}\n0%`;
  const next = () => {
    curr++;
    const doneChar = '■ ';
    const remaingChar = '□ ';
    const currBase10 = Math.floor((curr / steps) * 10);
    const progressString = Array.from({ length: 10 }, (_, i) => (i <= currBase10 ? doneChar : remaingChar)).join('');
    return `${progressString}\n${Math.floor((curr / steps) * 100)}%`;
  };
  return {
    initialMessage,
    next,
  };
};
