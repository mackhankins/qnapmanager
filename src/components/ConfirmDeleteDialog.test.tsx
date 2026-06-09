import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import type { LibraryItem } from "../api";

const items: LibraryItem[] = [
  { id: 1, title: "Big Show", service: "sonarr", size_on_disk: 88_130_000_000, added: null, tags: [], tag_labels: [] },
  { id: 2, title: "Doc", service: "radarr", size_on_disk: 9_700_000_000, added: null, tags: [], tag_labels: [] },
];

describe("ConfirmDeleteDialog", () => {
  it("lists every item and the total reclaimed size", () => {
    render(<ConfirmDeleteDialog items={items} onCancel={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.getByText("Doc")).toBeInTheDocument();
    expect(screen.getByText(/97\.8 GB/)).toBeInTheDocument(); // 88.1 + 9.7
  });

  it("fires onConfirm when confirmed", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDeleteDialog items={items} onCancel={() => {}} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: /delete 2 items/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
