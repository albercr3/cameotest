export const ELEMENT_DRAG_MIME = 'application/x-cameotest-element';

export interface DraggedElementPayload {
  elementId: string;
  elementType?: string;
  nodeKind?: 'element' | 'diagram';
  source?: 'tree' | 'canvas';
}
