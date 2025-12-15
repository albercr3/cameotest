export const ELEMENT_DRAG_MIME = 'application/x-cameotest-element';

export interface DraggedElementPayload {
  elementId: string;
  elementType?: string;
}
