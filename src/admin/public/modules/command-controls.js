export function initCommands({ $, notice, saveModuleSettings }) {
  function field(labelText, value, type = 'text') {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.value = value;
    label.append(input);
    return { label, input };
  }
  function responseRow(c) {
    const box = document.createElement('div');
    box.className = 'response';
    const row = document.createElement('div');
    row.className = 'row';
    const name = field('Command name', c.name),
      description = field('Description', c.description),
      text = field('Response', c.text, 'textarea');
    name.input.required = true;
    name.input.maxLength = 32;
    description.input.required = true;
    description.input.maxLength = 100;
    text.input.required = true;
    text.input.maxLength = 1800;
    const accessLabel = document.createElement('label');
    accessLabel.textContent = 'Who can use it';
    const access = document.createElement('select');
    for (const value of ['everyone', 'moderator', 'owner']) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = value;
      access.append(o);
    }
    access.value = c.access;
    accessLabel.append(access);
    row.append(name.label, description.label, accessLabel);
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = c.enabled;
    const toggle = document.createElement('label');
    toggle.append(enabled, 'Enabled');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'quiet';
    remove.textContent = 'Remove command';
    remove.onclick = () => {
      box.remove();
      notice('Response removed from the form. Save settings to apply.');
    };
    box.append(row, text.label, toggle, remove);
    box.read = () => ({
      name: name.input.value.trim(),
      description: description.input.value.trim(),
      text: text.input.value,
      enabled: enabled.checked,
      access: access.value,
    });
    $('responses').append(box);
  }
  
  const ids = (key) => $(key).value.split(/[\s,]+/).filter(Boolean);
  saveModuleSettings('commandsForm', () => ({
    disabled: [...$('builtins').querySelectorAll('input')].filter(i => !i.checked).map(i => i.value),
    responses: [...$('responses').children].map(row => row.read()),
    moderatorUserIds: ids('moderatorUserIds'), moderatorRoleIds: ids('moderatorRoleIds'),
  }));
  $('addResponse').onclick = () => {
    responseRow({ name: '', description: '', text: '', enabled: true, access: 'everyone' });
    notice('Response added to the form. Fill it in, then save settings.');
  };
  
  return { fillCommands(data) {
    $('builtins').replaceChildren(
      ...data.builtinNames.map((name) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = name;
        input.checked = !data.settings.disabled.includes(name);
        label.append(input, `/${name}`);
        return label;
      }),
    );
    $('responses').replaceChildren();
    data.settings.responses.forEach(responseRow);
    for (const key of ['moderatorUserIds', 'moderatorRoleIds'])
      $(key).value = data.settings[key].join('\n');
  
  } };
}
