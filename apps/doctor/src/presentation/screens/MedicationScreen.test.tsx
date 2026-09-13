import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ALERT_COPY_ES, NEVER_BLOCKS_ES, RULESET_VERSION } from '@recetas/rules';
import { ALERT_DISMISSAL_COPY_ES, dismissAlert } from '../../domain/alerts';
import { CONTROLLED_MEDICATIONS } from '../../domain/controlled-medications';
import type { PrescriptionDraft } from '../../domain/draft';
import { aDraft, anItem } from '../../test/fixtures';
import { alertsFor, editDraft, emptyItem } from '../draft-editing';
import { MedicationScreen } from './MedicationScreen';

/** D3 — Medicación (docs/17). */

const JUSTIFICATION = 'Sin alternativa terapéutica; la reacción previa fue cutánea y leve.';

function allergicDraft(): PrescriptionDraft {
  return aDraft({
    items: [anItem({ activeIngredient: 'amoxicilina' })],
    patientContext: { declaredAllergies: ['amoxicilina'], concomitantMedication: [] },
  });
}

function duplicatedDraft(): PrescriptionDraft {
  return aDraft({
    items: [
      anItem({ activeIngredient: 'ibuprofeno', atcCode: 'M01AE01' }),
      anItem({ activeIngredient: 'naproxeno', atcCode: 'M01AE02' }),
    ],
  });
}

function justified(draft: PrescriptionDraft): PrescriptionDraft {
  const [alert] = alertsFor(draft);
  if (alert === undefined) throw new Error('expected an alert');

  return editDraft(draft, {
    justifications: dismissAlert(draft.justifications, {
      alert,
      text: JUSTIFICATION,
      recordedAt: '2026-09-11T13:41:00.000Z',
    }),
  });
}

/** Renders the screen with real draft state, so an edit re-runs the engine. */
function renderScreen(initial: PrescriptionDraft = duplicatedDraft()) {
  const onContinue = vi.fn();
  const onCriticalAlert = vi.fn();

  function Harness() {
    const [draft, setDraft] = useState(initial);
    return (
      <MedicationScreen
        draft={draft}
        onBack={vi.fn()}
        onContinue={onContinue}
        onCriticalAlert={onCriticalAlert}
        onDraftChange={setDraft}
      />
    );
  }

  render(<Harness />);
  return { onContinue, onCriticalAlert, user: userEvent.setup() };
}

describe('every alert is auditable', () => {
  it('cites the exact input values that produced it', () => {
    renderScreen();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('M01AE01');
    expect(alert).toHaveTextContent('M01AE02');
  });

  it('cites the ruleset version that produced it', () => {
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent(RULESET_VERSION);
  });

  it('names its severity in words, never in colour alone', () => {
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent(/severidad moderada/i);
  });

  it('names the rule code, so the doctor can look it up', () => {
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent('DUPLICATE_THERAPY');
  });
});

describe('a decided alert stops shouting without disappearing', () => {
  it('moves into the quiet group, with the motive that was written', () => {
    renderScreen(justified(duplicatedDraft()));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(new RegExp(ALERT_DISMISSAL_COPY_ES.dismissedGroupTitle))).toBeVisible();
    expect(document.body.textContent).toContain(JUSTIFICATION);
  });

  it('comes back the moment the item that triggered it is edited', async () => {
    const { user } = renderScreen(justified(duplicatedDraft()));
    expect(screen.queryByRole('alert')).toBeNull();

    // Editing the second item's ATC code breaks the duplication AND the alert
    // identity the decision was recorded against.
    const atc = screen.getByLabelText(/Código ATC/, { selector: '#item-1-atc' });
    await user.clear(atc);
    await user.type(atc, 'J01CA04');

    expect(document.body.textContent).not.toContain(JUSTIFICATION);
    expect(screen.queryByRole('alert')).toBeNull();

    // And typing the collision back produces a LIVE alert again, unsuppressed.
    await user.clear(atc);
    await user.type(atc, 'M01AE02');

    expect(screen.getByRole('alert')).toHaveTextContent('M01AE02');
    expect(document.body.textContent).not.toContain(JUSTIFICATION);
  });
});

describe('no alert blocks the way forward', () => {
  // docs/06, docs/17: "Ninguna alerta clínica bloquea la emisión."
  it('states it where it cannot be missed', () => {
    renderScreen();

    expect(screen.getByText(NEVER_BLOCKS_ES)).toBeVisible();
  });

  it('leaves the control that moves on to D5 enabled with a critical alert live', async () => {
    const { onContinue, user } = renderScreen(allergicDraft());

    expect(screen.getByRole('alert')).toHaveTextContent(/severidad crítica/i);

    const onward = screen.getByRole('button', { name: /revisar y firmar/i });
    expect(onward).toBeEnabled();

    await user.click(onward);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('moves on with a critical alert that was justified', async () => {
    const { onContinue, user } = renderScreen(justified(allergicDraft()));

    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});

describe('the critical alert opens D4 and nothing else', () => {
  it('offers a control that raises the dialog, carrying the raw alert', async () => {
    const { onCriticalAlert, user } = renderScreen(allergicDraft());

    await user.click(screen.getByRole('button', { name: /valorar esta alerta/i }));

    expect(onCriticalAlert).toHaveBeenCalledOnce();
    expect(onCriticalAlert.mock.calls[0]?.[0]).toMatchObject({
      code: 'DECLARED_ALLERGY',
      severity: 'critical',
    });
  });

  it('offers no such control on a moderate alert', () => {
    renderScreen();

    expect(screen.queryByRole('button', { name: /valorar esta alerta/i })).toBeNull();
  });
});

describe('the form refuses to advance on incomplete items', () => {
  it('shows the catalogue message and does not continue', async () => {
    const { onContinue, user } = renderScreen(
      aDraft({ items: [anItem({ activeIngredient: '' })] }),
    );

    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText(/Complete principio activo, código ATC/)).toBeVisible();
  });

  it('ties the message to its control, and marks the control invalid', async () => {
    const { user } = renderScreen(aDraft({ items: [anItem({ activeIngredient: '' })] }));
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));

    const control = screen.getByLabelText(/Principio activo/);
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control.getAttribute('aria-describedby')).toContain('item-0-ingredient-error');
  });
});

describe('the controlled-medication catalogue', () => {
  /** A draft with the single blank line D3 opens with. */
  function blankDraft(): PrescriptionDraft {
    return aDraft({ items: [emptyItem()] });
  }

  /** The "Principio activo" and "Código ATC" controls of every item card, in order. */
  function itemValues(): { ingredient: string; atc: string }[] {
    const ingredients = screen.getAllByLabelText(/Principio activo/);
    return ingredients.map((control, index) => ({
      ingredient: (control as HTMLInputElement).value,
      atc: (screen.getByLabelText(/Código ATC/, { selector: `#item-${index}-atc` }) as HTMLInputElement)
        .value,
    }));
  }

  it('offers exactly ten medications, each as a checkbox with a real label', () => {
    renderScreen(blankDraft());

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(10);
    expect(boxes).toHaveLength(CONTROLLED_MEDICATIONS.length);

    for (const medication of CONTROLLED_MEDICATIONS) {
      const box = screen.getByRole('checkbox', { name: new RegExp(medication.activeIngredient) });
      expect(box).toHaveAccessibleName(new RegExp(medication.atcCode));
      expect(box).toHaveAccessibleName(new RegExp(medication.strength));
      expect(box).toHaveAccessibleName(new RegExp(medication.doseForm));
    }
  });

  it('adds a prefilled item card when one is checked', async () => {
    const { user } = renderScreen();
    expect(itemValues()).toHaveLength(2);

    await user.click(screen.getByRole('checkbox', { name: /tramadol/ }));

    expect(itemValues()).toEqual([
      { ingredient: 'ibuprofeno', atc: 'M01AE01' },
      { ingredient: 'naproxeno', atc: 'M01AE02' },
      { ingredient: 'tramadol', atc: 'N02AX02' },
    ]);
    expect(screen.getByRole('checkbox', { name: /tramadol/ })).toBeChecked();
    expect(
      screen.getByLabelText(/Concentración/, { selector: '#item-2-strength' }),
    ).toHaveValue('50 mg');
    expect(
      screen.getByLabelText(/Forma farmacéutica/, { selector: '#item-2-dose-form' }),
    ).toHaveValue('cápsula');
  });

  it('leaves quantity and dosage to the doctor', async () => {
    const { user } = renderScreen(blankDraft());

    await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

    expect(screen.getByLabelText(/Cantidad/, { selector: '#item-0-quantity' })).toHaveValue(0);
    expect(screen.getByLabelText(/Posología/, { selector: '#item-0-dosage' })).toHaveValue('');
  });

  it('adds one item per medication checked', async () => {
    const { user } = renderScreen(blankDraft());

    await user.click(screen.getByRole('checkbox', { name: /morfina/ }));
    await user.click(screen.getByRole('checkbox', { name: /diazepam/ }));

    expect(itemValues()).toEqual([
      { ingredient: 'morfina', atc: 'N02AA01' },
      { ingredient: 'diazepam', atc: 'N05BA01' },
    ]);
  });

  it('removes the item when it is unchecked', async () => {
    const { user } = renderScreen();

    await user.click(screen.getByRole('checkbox', { name: /tramadol/ }));
    expect(itemValues()).toHaveLength(3);

    await user.click(screen.getByRole('checkbox', { name: /tramadol/ }));

    expect(itemValues()).toEqual([
      { ingredient: 'ibuprofeno', atc: 'M01AE01' },
      { ingredient: 'naproxeno', atc: 'M01AE02' },
    ]);
    expect(screen.getByRole('checkbox', { name: /tramadol/ })).not.toBeChecked();
  });

  it('replaces the blank opening line rather than leaving it above', async () => {
    const { user } = renderScreen(blankDraft());

    await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

    expect(itemValues()).toEqual([{ ingredient: 'morfina', atc: 'N02AA01' }]);
  });

  it('renders checked a medication whose box wrote the line the draft carries', () => {
    renderScreen(
      aDraft({
        items: [anItem({ activeIngredient: 'diazepam', atcCode: 'N05BA01' })],
        catalogueSelections: ['diazepam'],
      }),
    );

    expect(screen.getByRole('checkbox', { name: /diazepam/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /morfina/ })).not.toBeChecked();
  });

  describe('a line the doctor typed that happens to coincide with a catalogue entry', () => {
    /**
     * Exactly what checking the diazepam box would have written — typed by hand
     * through "Añadir otro ítem" instead. The box never ran, so it must not
     * claim the line, and clicking it must not delete it.
     */
    function coincidingDraft(): PrescriptionDraft {
      return aDraft({
        items: [
          anItem({
            activeIngredient: 'diazepam',
            atcCode: 'N05BA01',
            strength: '10 mg',
            doseForm: 'comprimido',
            quantity: 0,
            dosageInstruction: '',
          }),
        ],
      });
    }

    it('renders its box unchecked', () => {
      renderScreen(coincidingDraft());

      expect(screen.getByRole('checkbox', { name: /diazepam/ })).not.toBeChecked();
    });

    it('adds a second prefilled line when the box is checked, and keeps the typed one', async () => {
      const { user } = renderScreen(coincidingDraft());

      await user.click(screen.getByRole('checkbox', { name: /diazepam/ }));

      expect(itemValues()).toEqual([
        { ingredient: 'diazepam', atc: 'N05BA01' },
        { ingredient: 'diazepam', atc: 'N05BA01' },
      ]);
      expect(screen.getByRole('checkbox', { name: /diazepam/ })).toBeChecked();
    });
  });

  it('raises the duplicate-therapy alert when two entries share an ATC subgroup', async () => {
    // diazepam N05BA01 and alprazolam N05BA12 share ATC level 4 N05BA, which is
    // exactly what packages/rules/src/engine.ts calls a duplication.
    const { user } = renderScreen(blankDraft());

    await user.click(screen.getByRole('checkbox', { name: /diazepam/ }));
    await user.click(screen.getByRole('checkbox', { name: /alprazolam/ }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(ALERT_COPY_ES.DUPLICATE_THERAPY.title);
    expect(alert).toHaveTextContent(ALERT_COPY_ES.DUPLICATE_THERAPY.body);
    expect(alert).toHaveTextContent('N05BA01');
    expect(alert).toHaveTextContent('N05BA12');
  });

  describe('a line the doctor has typed into is never removed by the checkbox', () => {
    it('keeps the item and the checkbox when a quantity has been typed', async () => {
      const { user } = renderScreen(blankDraft());
      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

      const quantity = screen.getByLabelText(/Cantidad/, { selector: '#item-0-quantity' });
      await user.clear(quantity);
      await user.type(quantity, '30');

      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

      expect(itemValues()).toEqual([{ ingredient: 'morfina', atc: 'N02AA01' }]);
      expect(screen.getByRole('checkbox', { name: /morfina/ })).toBeChecked();
      expect(quantity).toHaveValue(30);
    });

    it('keeps the item and the checkbox when a dosage has been typed', async () => {
      const { user } = renderScreen(blankDraft());
      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

      const dosage = screen.getByLabelText(/Posología/, { selector: '#item-0-dosage' });
      await user.type(dosage, '1 comprimido cada 8 horas');

      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

      expect(itemValues()).toEqual([{ ingredient: 'morfina', atc: 'N02AA01' }]);
      expect(screen.getByRole('checkbox', { name: /morfina/ })).toBeChecked();
      expect(dosage).toHaveValue('1 comprimido cada 8 horas');
    });

    it('keeps the item and explains why when the prefilled strength has been corrected', async () => {
      const { user } = renderScreen(blankDraft());
      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));
      const box = screen.getByRole('checkbox', { name: /morfina/ });

      const strength = screen.getByLabelText(/Concentración/, { selector: '#item-0-strength' });
      await user.clear(strength);
      await user.type(strength, '20 mg');

      await user.click(box);

      expect(itemValues()).toEqual([{ ingredient: 'morfina', atc: 'N02AA01' }]);
      expect(box).toBeChecked();
      expect(strength).toHaveValue('20 mg');
      expect(box.getAttribute('aria-describedby')).not.toBeNull();
    });

    it('explains why, in text tied to the checkbox itself', async () => {
      const { user } = renderScreen(blankDraft());
      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));
      const box = screen.getByRole('checkbox', { name: /morfina/ });
      expect(box).not.toHaveAttribute('aria-describedby');

      await user.type(
        screen.getByLabelText(/Posología/, { selector: '#item-0-dosage' }),
        '1 comprimido cada 8 horas',
      );

      const noteId = box.getAttribute('aria-describedby');
      expect(noteId).not.toBeNull();
      const note = document.getElementById(noteId as string);
      expect(note).toBeVisible();
      expect(note).toHaveTextContent(/cantidad y posología/i);
      expect(note).toHaveTextContent(/Quitar ítem/);
    });
  });

  describe('the per-item removal control the hint sends the doctor to', () => {
    it('is available on a draft that holds a single item', () => {
      renderScreen(blankDraft());

      expect(screen.getByRole('button', { name: /quitar ítem 1/i })).toBeEnabled();
    });

    it('clears the only line back to a blank one and unchecks its box', async () => {
      // The flow the hint names: one line, typed work on it, so the checkbox
      // refuses to remove it. The button it points at has to finish the job.
      const { user } = renderScreen(blankDraft());
      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

      const quantity = screen.getByLabelText(/Cantidad/, { selector: '#item-0-quantity' });
      await user.clear(quantity);
      await user.type(quantity, '30');

      await user.click(screen.getByRole('button', { name: /quitar ítem 1/i }));

      expect(itemValues()).toEqual([{ ingredient: '', atc: '' }]);
      expect(screen.getByRole('checkbox', { name: /morfina/ })).not.toBeChecked();
    });
  });

  describe('a prefilled line edited away from the catalogue entry', () => {
    it('renders the box unchecked and adds a fresh line when it is checked again', async () => {
      const { user } = renderScreen(blankDraft());
      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

      const ingredient = screen.getByLabelText(/Principio activo/, {
        selector: '#item-0-ingredient',
      });
      await user.clear(ingredient);
      await user.type(ingredient, 'morfina liberación prolongada');

      expect(screen.getByRole('checkbox', { name: /morfina/ })).not.toBeChecked();

      await user.click(screen.getByRole('checkbox', { name: /morfina/ }));

      expect(itemValues()).toEqual([
        { ingredient: 'morfina liberación prolongada', atc: 'N02AA01' },
        { ingredient: 'morfina', atc: 'N02AA01' },
      ]);
      expect(screen.getByRole('checkbox', { name: /morfina/ })).toBeChecked();
    });
  });

  it('keeps the free-text path: another item can still be added and edited', async () => {
    const { user } = renderScreen(blankDraft());

    await user.click(screen.getByRole('button', { name: /añadir otro ítem/i }));
    const ingredient = screen.getByLabelText(/Principio activo/, { selector: '#item-1-ingredient' });
    await user.type(ingredient, 'ibuprofeno');

    expect(ingredient).toHaveValue('ibuprofeno');
    expect(screen.getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toEqual(
      [],
    );
  });
});

describe('D-07: no commercial product catalogue exists', () => {
  it('prescribes by active ingredient and ATC code only', () => {
    renderScreen();

    expect(screen.getByLabelText(/Principio activo/, { selector: '#item-0-ingredient' })).toBeVisible();
    expect(screen.getByLabelText(/Código ATC/, { selector: '#item-0-atc' })).toBeVisible();
    expect(screen.queryByLabelText(/marca|nombre comercial|producto comercial/i)).toBeNull();
  });
});
