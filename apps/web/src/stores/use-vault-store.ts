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
  replaceMedia: (media: MediaMock[]) => void;
  replaceAssets: (assets: AssetMock[]) => void;
  replacePlaces: (places: PlaceMock[]) => void;
  upsertMedia: (media: MediaMock) => void;
  upsertAsset: (asset: AssetMock) => void;
  upsertPlace: (place: PlaceMock) => void;
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
      replaceMedia: (media) => set({ media }),
      replaceAssets: (assets) => set({ assets }),
      replacePlaces: (places) => set({ places }),
      upsertMedia: (media) =>
        set((state) => ({
          media: state.media.some((item) => item.id === media.id)
            ? state.media.map((item) => (item.id === media.id ? media : item))
            : [media, ...state.media],
        })),
      upsertAsset: (asset) =>
        set((state) => ({
          assets: state.assets.some((item) => item.id === asset.id)
            ? state.assets.map((item) => (item.id === asset.id ? asset : item))
            : [asset, ...state.assets],
        })),
      upsertPlace: (place) =>
        set((state) => ({
          places: state.places.some((item) => item.id === place.id)
            ? state.places.map((item) => (item.id === place.id ? place : item))
            : [place, ...state.places],
        })),
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
