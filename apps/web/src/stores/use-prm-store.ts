"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { GIFT_MOCK, NETWORK_EDGE_MOCK, PEOPLE_MOCK, type GiftMock, type NetworkEdgeMock, type PersonMock } from "@/lib/mock/prm";

type PRMState = {
  people: PersonMock[];
  gifts: GiftMock[];
  networkEdges: NetworkEdgeMock[];
  replaceSnapshot: (snapshot: Pick<PRMState, "people" | "gifts" | "networkEdges">) => void;
  markContacted: (personId: string) => void;
  toggleFavorite: (personId: string) => void;
};

export const usePRMStore = create<PRMState>()(
  persist(
    (set) => ({
      people: PEOPLE_MOCK,
      gifts: GIFT_MOCK,
      networkEdges: NETWORK_EDGE_MOCK,
      replaceSnapshot: (snapshot) => set({ people: snapshot.people, gifts: snapshot.gifts, networkEdges: snapshot.networkEdges }),
      markContacted: (personId) =>
        set((state) => ({
          people: state.people.map((person) =>
            person.id === personId
              ? {
                  ...person,
                  daysSinceContact: 0,
                  timeline: [{ id: `interaction-${Date.now()}`, date: new Date().toISOString().slice(0, 10), title: "직접 연락 완료", kind: "interaction" }, ...person.timeline],
                }
              : person,
          ),
        })),
      toggleFavorite: (personId) =>
        set((state) => ({
          people: state.people.map((person) =>
            person.id === personId
              ? {
                  ...person,
                  favorite: !person.favorite,
                }
              : person,
          ),
        })),
    }),
    {
      name: "light-house-prm",
    },
  ),
);
