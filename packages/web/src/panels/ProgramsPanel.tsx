import { moveProgram } from '@sponcam/core';
import { allPrograms } from '@/state/programList';
import { appStore, useApp } from '@/state/store';
import { PanelBody } from './PanelBody';
import { ProgramRow } from './ProgramRow';
import { SortableList } from './SortableList';

export function ProgramsPanel() {
  const programs = useApp((s) => allPrograms(s));
  const imported = useApp((s) => s.job.programs);
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
              {generated.map((p) => <li key={p.id}><ProgramRow p={p} index={-1} count={0} /></li>)}
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
            {(p, handle) => <ProgramRow p={p} index={imported.findIndex((x) => x.id === p.id)} count={imported.length} dragHandle={handle} />}
          </SortableList>
        </div>
      )}
    </PanelBody>
  );
}
