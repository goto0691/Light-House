"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  ASSETS_MOCK,
  MEDIA_MOCK,
  PLACES_MOCK,
  ZETTELS_MOCK,
  type AssetMock,
  type MediaMock,
  type PlaceMock,
  type ZettelMock,
} from "@/lib/mock/vault";

type VaultState = {
  selectedZettelId: string;
  zettels: ZettelMock[];
  media: MediaMock[];
  assets: AssetMock[];
  places: PlaceMock[];
  replaceSnapshot: (snapshot: Pick<VaultState, "selectedZettelId" | "zettels" | "media" | "assets" | "places">) => void;
  selectZettel: (id: string) => void;
  updateZettelContent: (id: string, content: string) => void;
  updateZettelTitle: (id: string, title: string) => void;
  cycleMediaStatus: (id: string) => void;
  updatePlaceReview: (id: string, review: string) => void;
};

const MEDIA_STATUS_ORDER: MediaMock["status"][] = ["backlog", "consuming", "completed"];

export const useVaultStore = create<VaultState>()(
  persist(
    (set) => ({
      selectedZettelId: ZETTELS_MOCK[0]?.id ?? "",
      zettels: ZETTELS_MOCK,
      media: MEDIA_MOCK,
      assets: ASSETS_MOCK,
      places: PLACES_MOCK,
      replaceSnapshot: (snapshot) =>
        set({
          selectedZettelId: snapshot.selectedZettelId,
          zettels: snapshot.zettels,
          media: snapshot.media,
          assets: snapshot.assets,
          places: snapshot.places,
        }),
      selectZettel: (id) => set({ selectedZettelId: id }),
      updateZettelContent: (id, content) =>
        set((state) => ({
          zettels: state.zettels.map((zettel) => (zettel.id === id ? { ...zettel, content } : zettel)),
        })),
      updateZettelTitle: (id, title) =>
        set((state) => ({
          zettels: state.zettels.map((zettel) =>
            zettel.id === id
              ? {
                  ...zettel,
                  title,
                }
              : zettel,
          ),
        })),
      cycleMediaStatus: (id) =>
        set((state) => ({
          media: state.media.map((item) => {
            if (item.id !== id) return item;
            const current = MEDIA_STATUS_ORDER.indexOf(item.status);
            return { ...item, status: MEDIA_STATUS_ORDER[(current + 1) % MEDIA_STATUS_ORDER.length] };
          }),
        })),
      updatePlaceReview: (id, review) =>
        set((state) => ({
          places: state.places.map((place) => (place.id === id ? { ...place, review } : place)),
        })),
    }),
    {
      name: "light-house-vault",
    },
  ),
);
