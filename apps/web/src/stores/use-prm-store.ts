"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { GIFT_MOCK, PEOPLE_MOCK, type PersonMock } from "@/lib/mock/prm";

type PRMState = {
  people: PersonMock[];
  replaceSnapshot: (snapshot: Pick<PRMState, "people">) => void;
  markContacted: (personId: string) => void;
  toggleFavorite: (personId: string) => void;
};

export const usePRMStore = create<PRMState>()(
  persist(
    (set) => ({
      people: PEOPLE_MOCK,
      replaceSnapshot: (snapshot) => set({ people: snapshot.people }),
      markContacted: (personId) =>
        set((state) => ({
          people: state.people.map((person) =>
            person.id === personId
              ? {
                  ...person,
                  daysSinceContact: 0,
                  timeline: [{ date: new Date().toISOString().slice(0, 10), title: "직접 연락 완료", kind: "interaction" }, ...person.timeline],
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
