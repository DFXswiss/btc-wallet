import React, { useCallback, useContext } from "react";
import { BlueStorageContext } from "../blue_modules/storage-context";

export const usePrivateText = () => {
    const { hideBalance } = useContext(BlueStorageContext);
    return useCallback((string: string) => hideBalance ? '*****' : string, [hideBalance]);
};