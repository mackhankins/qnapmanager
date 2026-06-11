import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LibraryTable } from "./LibraryTable";
import type { LibraryItem } from "../api";

const items: LibraryItem[] = [
  { id: 1, title: "Big Show", service: "sonarr", size_on_disk: 88_130_000_000, status: "ended", added: null, tags: [1], tag_labels: ["temporary"] },
  { id: 2, title: "Blockbuster", service: "radarr", size_on_disk: 38_400_000_000, status: "released", added: null, tags: [], tag_labels: [] },
];

describe("LibraryTable", () => {
  it("renders rows for all items by default", () => {
    render(<LibraryTable items={items} onDelete={() => {}} onToggleTag={() => {}} onBulkDelete={() => {}} />);
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.getByText("Blockbuster")).toBeInTheDocument();
  });

  it("filters to temporary when the chip is clicked", async () => {
    render(<LibraryTable items={items} onDelete={() => {}} onToggleTag={() => {}} onBulkDelete={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /^temporary$/i }));
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.queryByText("Blockbuster")).not.toBeInTheDocument();
  });

  it("filters by Movies type chip", async () => {
    render(<LibraryTable items={items} onDelete={() => {}} onToggleTag={() => {}} onBulkDelete={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /^movies$/i }));
    expect(screen.getByText("Blockbuster")).toBeInTheDocument();
    expect(screen.queryByText("Big Show")).not.toBeInTheDocument();
  });

  it("clears the search box via the clear button", async () => {
    render(<LibraryTable items={items} onDelete={() => {}} onToggleTag={() => {}} onBulkDelete={() => {}} />);
    const input = screen.getByPlaceholderText(/search title/i);
    await userEvent.type(input, "Big");
    expect(input).toHaveValue("Big");
    await userEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect(input).toHaveValue("");
  });

  it("filters by the selected status", async () => {
    render(<LibraryTable items={items} onDelete={() => {}} onToggleTag={() => {}} onBulkDelete={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "ended");
    expect(screen.getByText("Big Show")).toBeInTheDocument();
    expect(screen.queryByText("Blockbuster")).not.toBeInTheDocument();
  });
});
