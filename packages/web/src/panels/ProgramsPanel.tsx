import { moveProgram } from '@sponcam/core';
import { allPrograms } from '@/state/programList';
import { appStore, useApp } from '@/state/store';
import { PanelBody } from './PanelBody';
import { ProgramRow } from './ProgramRow';
import { SortableList } from './SortableList';

export function ProgramsPanel() {
  const programs = useApp((s) => allPrograms(s));
  const generated = programs.filter((p) => p.source === 'generated');
  const importedShown = programs.filter((p) => p.source !== 'generated');

  return (
    <PanelBody>
      {programs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No programs. Open or drop a G-code file (.nc, .ngc, .gcode, .tap, .cnc).</p>
      ) : (
        <div className="space-y-1">
          {generated.length > 0 && (
            <ul className="space-y-1">
              {generated.map((p) => <li key={p.id}><ProgramRow p={p} /></li>)}
            </ul>
          )}
          <SortableList
            items={importedShown} label={(p) => p.name} handleTestId="program-drag"
            onMove={(id, steps) => appStore.getState().commit((j) => {
              let out = j;
              for (let i = 0; i < Math.abs(steps); i++) out = moveProgram(out, id, steps > 0 ? 1 : -1);
              return out;
            })}
          >
            {(p, handle, index) => <ProgramRow p={p} index={index} count={importedShown.length} dragHandle={handle} />}
          </SortableList>
        </div>
      )}
    </PanelBody>
  );
}
