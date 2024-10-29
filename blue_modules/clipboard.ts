import { useAsyncStorage } from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';

const BlueClipboard = () => {
  const defaultValue = false;
  const STORAGE_KEY = 'ClipboardReadAllowed';
  const { getItem, setItem } = useAsyncStorage(STORAGE_KEY);

  const isReadClipboardAllowed = async () => {
    try {
      const clipboardAccessAllowed = await getItem();
      if (clipboardAccessAllowed === null) {
        await setItem(JSON.stringify(defaultValue));
        return defaultValue;
      }
      return !!JSON.parse(clipboardAccessAllowed);
    } catch {
      await setItem(JSON.stringify(defaultValue));
      return defaultValue;
    }
  };

  const setReadClipboardAllowed = (value: boolean) => {
    setItem(JSON.stringify(!!value));
  };

  const getClipboardContent = async () => {
    try {
      const isAllowed = await isReadClipboardAllowed();
      if (isAllowed) {
        return Clipboard.getString();
      } else {
        return '';
      }
    } catch {
      return '';
    }
  };

  return {
    isReadClipboardAllowed,
    setReadClipboardAllowed,
    getClipboardContent,
  };
};

export default BlueClipboard;
