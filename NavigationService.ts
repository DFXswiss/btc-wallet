import { createNavigationContainerRef, NavigationAction, ParamListBase } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<ParamListBase>();

export function navigate(name: string, params?: object, options?: { merge?: boolean }): void {
  if (navigationRef.isReady()) {
    // v7 object form of navigate()
    navigationRef.current?.navigate({ name, params, merge: options?.merge });
  }
}

export function dispatch(action: NavigationAction): void {
  if (navigationRef.isReady()) {
    navigationRef.current?.dispatch(action);
  }
}
