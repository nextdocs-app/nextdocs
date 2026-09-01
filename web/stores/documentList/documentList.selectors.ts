import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../store';

export const selectSharedWithMeDocumentIds = createSelector(
  (state: RootState) => state.documentList?.sharedWithMeDocuments ?? [],
  (sharedWithMe) => sharedWithMe.map((doc) => doc.id)
);

export const selectRootLevelOwnerSharedDocumentIds = createSelector(
  (state: RootState) => state.documentList?.ownerSharedDocuments ?? [],
  (ownerShared) => ownerShared.filter((doc) => doc.parentId == null).map((doc) => doc.id)
);
