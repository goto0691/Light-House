"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { GIFT_MOCK, NETWORK_EDGE_MOCK, PEOPLE_MOCK, type GiftMock, type NetworkEdgeMock, type PersonMock } from "@/lib/mock/prm";

export type PRMMutationDelta = {
  deletedGiftId?: string;
  deletedInteractionId?: string;
  deletedNetworkEdgeId?: string;
  gift?: GiftMock;
  networkEdge?: NetworkEdgeMock;
  person?: PersonMock | null;
};

type PRMState = {
  people: PersonMock[];
  gifts: GiftMock[];
  networkEdges: NetworkEdgeMock[];
  applyMutationDelta: (delta: PRMMutationDelta) => void;
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
      applyMutationDelta: (delta) =>
        set((state) => {
          const people = delta.person
            ? state.people.some((person) => person.id === delta.person!.id)
              ? state.people.map((person) => (person.id === delta.person!.id ? delta.person! : person))
              : [...state.people, delta.person]
            : state.people;
          const withGift = delta.gift
            ? state.gifts.some((gift) => gift.id === delta.gift!.id)
              ? state.gifts.map((gift) => (gift.id === delta.gift!.id ? delta.gift! : gift))
              : [delta.gift, ...state.gifts]
            : state.gifts;
          const gifts = delta.deletedGiftId ? withGift.filter((gift) => gift.id !== delta.deletedGiftId) : withGift;
          const withNetworkEdge = delta.networkEdge
            ? state.networkEdges.some((edge) => edge.id === delta.networkEdge!.id)
              ? state.networkEdges.map((edge) => (edge.id === delta.networkEdge!.id ? delta.networkEdge! : edge))
              : [delta.networkEdge, ...state.networkEdges]
            : state.networkEdges;
          const networkEdges = delta.deletedNetworkEdgeId ? withNetworkEdge.filter((edge) => edge.id !== delta.deletedNetworkEdgeId) : withNetworkEdge;

          return { gifts, networkEdges, people };
        }),
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
