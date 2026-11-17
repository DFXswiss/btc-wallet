import AsyncStorageMock from '@react-native-async-storage/async-storage/jest/async-storage-mock';

// The official mock puts `useAsyncStorage` on the default object. Named imports
// (`import { useAsyncStorage }`) read `exports.useAsyncStorage`, not a property
// of `exports.default`, so the hook must be re-exported or storage-context.js:27
// throws `useAsyncStorage is not a function` and the provider never renders.
export const useAsyncStorage = AsyncStorageMock.useAsyncStorage;

export default AsyncStorageMock;
