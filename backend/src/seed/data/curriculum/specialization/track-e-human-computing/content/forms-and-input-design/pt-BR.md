---
version: 1.0
updatedAt: 2026-11-04
title: "Design de Formulários e de Entrada de Dados"
summary: "Rótulos, tipos de entrada, valores padrão, momento da validação e mensagens de erro, para formulários que as pessoas de fato terminam."
---
## Objetivos de Aprendizagem

- Separar conselhos sobre formulários em evidência medida, requisito normativo e convenção.
- Dizer o que os estudos sobre posição de rótulo e validação inline mediram, com seus limites.
- Separar o que `type`, `inputmode`, `autocomplete` e `pattern` fazem em um navegador.
- Escolher valores padrão que ajudam sem empurrar as pessoas para uma resposta errada.
- Escrever mensagens de erro que atendem à WCAG 2.2 e dizer o que um verificador automático não confere.

## Contexto e Motivação

`navigation-menus-windows-and-information-architecture` leva as pessoas ao lugar certo, e muitas vezes o que elas encontram ali é um formulário. Conselho sobre formulários costuma ser confiante e ter pouca evidência: boa parte vem de poucos estudos pequenos, alguns dos quais se contradizem. Mantenha três coisas separadas:

- **Evidência:** um estudo mediu, em condições declaradas.
- **Requisito:** uma especificação ou a WCAG diz, e isso define o que é conformidade, não o que é mais rápido.
- **Convenção:** quem pratica concorda, e os usuários podem esperar aquilo, mas ninguém mediu.

## Teoria Central

### Rótulos

Todo campo precisa de rótulo. O Critério de Sucesso 3.3.2 da WCAG 2.2, Labels or Instructions (Nível A), diz: "Labels or instructions are provided when content requires user input." Em HTML, isso significa um `<label for="id">`.

**Posição.** O estudo por trás da maior parte dos conselhos é Penzo (2006), uma comparação com eye tracking de formulários com rótulos alinhados à esquerda, à direita e acima do campo, com usuários experientes e novatos. O artigo não informa o número de participantes e avisa que a montagem "didn't resemble real-world conditions". O movimento típico do olho do rótulo ao campo levou cerca de 500 ms com rótulos alinhados à esquerda, cerca de 170 ms (experientes) a 240 ms (novatos) com alinhamento à direita e 50 ms com rótulos acima. O alinhamento à direita cortou fixações e tempos de preenchimento quase pela metade em relação ao alinhamento à esquerda.

Bargas-Avila et al. (2010) transformaram isso na Diretriz 5: coloque rótulos acima dos campos para preencher o formulário o mais rápido possível, citando Penzo. Eles também relatam o conselho de Wroblewski de usar rótulos à esquerda para dados pouco familiares, quando se quer que as pessoas desacelerem. Seckler et al. (2014) depois testaram as 20 diretrizes em três formulários reais de sites de notícias, com 65 participantes divididos entre versões original (32) e melhorada (33). Os formulários melhorados exigiram menos tentativas de envio nos três e foram significativamente mais rápidos em dois. Mas todas as diretrizes mudaram juntas, então isso não diz nada sobre rótulos isoladamente. Classifique a regra como evidência fraca e convenção forte.

**Placeholder não é rótulo.** Sherwin (2014, NN/g) relata, a partir de testes com usuários, que placeholders no lugar de rótulos sobrecarregam a memória, porque a dica some ao digitar, e impedem as pessoas de conferir o que preencheram antes de enviar. Ela admite que isso pesa menos em formulários de um ou dois campos. O GOV.UK acrescenta que nem todo leitor de tela lê placeholders e que os estilos padrão dos navegadores muitas vezes falham em contraste.

### Quatro atributos, quatro funções

| Atributo | O que faz | O que não faz |
|---|---|---|
| `type` | Define semântica, validação embutida e controle | Garantir um teclado útil em todo dispositivo |
| `inputmode` | Sugere qual teclado virtual mostrar | Validar qualquer coisa |
| `autocomplete` | Nomeia o dado, para o preenchimento automático | Validar ou substituir o rótulo |
| `pattern` | Acrescenta uma restrição por expressão regular | Mudar o teclado ou se explicar ao usuário |

A MDN afirma que `inputmode` "doesn't cause any validity requirements to be enforced on input". A especificação HTML diz que `type=number` "is not appropriate for input that happens to only consist of numbers but isn't strictly speaking a number", citando números de cartão de crédito e códigos postais dos EUA, e sugere perguntar se um spinbox faria sentido. O GOV.UK trocou `type="number"` por `<input type="text" inputmode="numeric" pattern="[0-9]*">` em 2020. Os motivos foram achados de acessibilidade e comportamento: problemas com Dragon e NVDA, letras descartadas em silêncio e valores alterados pela roda do mouse, embora sua pesquisa com usuários de 2017 não tivesse apontado problemas graves. Seu exemplo atual de campo de texto usa `inputmode="numeric"` sem `pattern`.

Para `tel`, a especificação "does not enforce a particular syntax", de propósito. Para `email`, ela define sintaxe própria como uma "willful violation" da RFC 5322.

Os valores de `autocomplete` são uma lista fixa na especificação, como `name`, `email`, `postal-code`, `new-password` e `one-time-code`. O CS 1.3.5 da WCAG, Identify Input Purpose (Nível AA), exige que a finalidade de campos que coletam dados sobre o usuário possa ser determinada por programa, onde a tecnologia permite.

### Valores padrão

A evidência aqui é indireta e vem de outro domínio. Nielsen (2005) relata um estudo de Cornell com resultados de busca: 42% dos usuários clicaram no primeiro resultado e, depois que os dois primeiros foram trocados em segredo, 34% ainda clicaram no primeiro. As pessoas se apoiam no que aparece antes, mas isso é uma página de busca, não um formulário. Seu conselho para formulários, pré-preencher com o valor mais comum, é um argumento: quem precisa mudar teria de digitar de qualquer forma. Trate isso como convenção. Um valor padrão também é uma afirmação que o usuário pode não notar, então tenha cuidado com ele em respostas com consequências, como consentimento, em que um valor errado e silencioso custa mais do que um clique a mais.

Duas regras são mais firmes. O CS 3.3.7 da WCAG, Redundant Entry (Nível A), exige que informação já dada no mesmo processo seja preenchida automaticamente ou fique disponível para seleção, com exceções. A Diretriz 15 de Bargas-Avila e o padrão do GOV.UK também proíbem limpar campos preenchidos depois de um erro.

### Quando validar

Aqui as fontes discordam, e você deve saber disso.

**Contra o feedback imediato.** Bargas-Avila et al. (2007) fizeram dois estudos, com 77 e 90 participantes, e relatam que mostrar os campos errados depois do formulário inteiro funciona melhor e que o feedback imediato teve o pior desempenho, com usuários muitas vezes ignorando as mensagens. Eles propõem que as pessoas ficam em modo de Preenchimento ou de Revisão e têm menos disposição para corrigir erros durante o Preenchimento. O capítulo de 2010 acrescenta que erros mostrados ao sair do campo levaram a significativamente mais erros.

**A favor do feedback inline.** Wroblewski (2009), com a empresa Etre, testou 22 usuários, de 21 a 49 anos, em seis versões de um formulário de cadastro, uma delas validando só no envio. A melhor versão inline, contra esse controle, deu 22% a mais de sucesso, 22% menos erros, 31% mais satisfação, 42% menos tempo de preenchimento e 47% menos fixações oculares. Esses números comparam uma melhor variante com o controle, sem testes estatísticos. Só 30% a 50% dos participantes viram mensagens nos campos fáceis, contra 80% a 100% em nome de usuário e senha, e marcas verdes em um nome confundiram as pessoas. Validar depois do campo ganhou de validar durante a digitação por sete a dez segundos, e mostrar mensagens desde o foco deu tempos maiores, mais erros e pior satisfação.

**A orientação se divide do mesmo jeito.** Krause (2019, NN/g): "Ideally, all validation should be inline". GOV.UK: "Do not validate when the user moves away from a field." Os dois experimentos usaram formulários diferentes, então nenhum derruba o outro.

**No que essas fontes concordam.** Não mostre erro antes de a pessoa terminar o campo. Wroblewski mediu o dano, e Krause e o GOV.UK desaconselham. O caso a favor do feedback ao vivo é mais forte para respostas que a pessoa não tem como saber de antemão, como a disponibilidade de um nome de usuário, embora o GOV.UK peça pesquisa com usuários até para isso. E verificações no cliente nunca bastam: o GOV.UK nota que a validação no servidor é sempre necessária, já que o usuário pode contornar o cliente ou o JavaScript pode não carregar.

### Mensagens de erro

O CS 3.3.1 da WCAG, Error Identification (Nível A), exige que "the item that is in error is identified and the error is described to the user in text." O CS 3.3.3, Error Suggestion (Nível AA), exige sugerir uma correção quando ela é conhecida, salvo se isso comprometer a segurança ou a finalidade. Uma borda vermelha sozinha falha no primeiro.

Mensagens podem simplesmente ser ignoradas. No formulário do Süddeutsche em Seckler et al., 14 erros consecutivos na condição original foram reenvios sem correção, contra nenhum na melhorada, com todas as diretrizes mudando juntas. A redação é sobretudo convenção, e há conflito. A Diretriz 14 de Bargas-Avila diz que as mensagens devem ser educadas e, eventualmente, pedir desculpas. O GOV.UK manda não usar "sorry" nem "please". Ambos concordam que a mensagem precisa dizer o que está errado e como consertar, e o GOV.UK rejeita texto genérico como "This field is required".

### Evidência ou convenção

| Conselho | Classificação |
|---|---|
| Todo campo tem rótulo | Requisito (CS 3.3.2) |
| Rótulo acima do campo é mais rápido | Evidência fraca (Penzo), convenção forte |
| Não trocar rótulos por placeholders | Pesquisa de prática, orientação do GOV.UK |
| Nenhum erro antes de terminar o campo | Medido e amplamente aceito |
| Inline a cada campo, ou tudo no envio | Contestado |
| Mensagem diz em texto o que está errado | Requisito (CS 3.3.1) |
| Pedir desculpas em mensagens de erro | Convenção, fontes em conflito |

## Exemplos Resolvidos

### Exemplo 1: um formulário de entrega

```html
<form method="post" action="/entrega">
  <label for="nome">Nome completo</label>
  <input id="nome" name="nome" type="text" autocomplete="name" required>

  <label for="email">E-mail</label>
  <input id="email" name="email" type="email" autocomplete="email" required>

  <label for="tel">Celular com DDD</label>
  <input id="tel" name="tel" type="tel" autocomplete="tel" required>

  <label for="cep">CEP</label>
  <p id="cep-hint">8 dígitos, com ou sem hífen</p>
  <input id="cep" name="cep" type="text" inputmode="numeric"
         autocomplete="postal-code" pattern="[0-9]{5}-?[0-9]{3}"
         aria-describedby="cep-hint" required>

  <button>Continuar</button>
</form>
```

O CEP é um código, então usa `type="text"`: zero à esquerda importa, e um spinbox não faz sentido. O `pattern="[0-9]*"` habitual rejeitaria `01310-100`, que é como se escreve no Brasil, então o padrão aceita as duas formas, no espírito do conselho do GOV.UK de aceitar variações sem ambiguidade. No Chrome 156, `01310-100` e `01310100` são válidos, enquanto `01310 100`, `0131` e `abcde-fgh` dão `patternMismatch`. O conselho do GOV.UK vai além: ignorar esses caracteres soltos no servidor. O GOV.UK desliga a validação nativa com `novalidate`, então `required` aqui é uma escolha, não uma regra.

### Exemplo 2: o que o navegador de fato impõe

Digitando com eventos reais de teclado em cada campo, no Chrome 156 de desktop em modo headless:

```text
input                      typed                value kept            validity
type=number                12a                  "12"                  valid (a dropped silently)
type=number                1e                   ""                    badInput
type=number                007                  "007"                 valid, number 7
type=number                1234567890123456789  same, then ArrowUp    "1.23456789012345678e+18"
type=email                 ana@                 "ana@"                typeMismatch
type=email                 ana@b                "ana@b"               valid
type=tel                   banana               "banana"              valid
text + inputmode=numeric   abc                  "abc"                 valid
inputmode + pattern [0-9]* 12a                  "12a"                 patternMismatch
```

Uma letra descartada em silêncio não dá retorno. `ana@b` passa, então `type=email` válido não significa endereço entregável. `tel` e `inputmode` não validam nada. A seta para cima transformou um identificador longo em notação exponencial, a mesma falha que o GOV.UK relatou no Chrome 79. O teclado virtual exige teste em aparelhos reais.

### Exemplo 3: o que o axe não vê

Rodando o axe-core 4.14 em páginas pequenas no mesmo navegador:

```text
markup                                   axe violations
<label for> + input                      none
input with placeholder only              none
input with no name at all                label
autocomplete="e-mail" (invalid token)    autocomplete-valid
aria-invalid + red border, no message    none
```

O campo só com placeholder passa porque o axe aceita um placeholder como nome, embora as objeções de Sherwin e do GOV.UK continuem valendo. O caso da borda vermelha passa embora falhe no CS 3.3.1, já que o axe não tem como saber que não existe texto de erro. O Exemplo 1 também tem zero violações, o que mostra que passou nas verificações que o axe consegue rodar, não que está em conformidade.

### Exemplo 4: escolhendo o momento, campo a campo

No Chrome 156, um campo de e-mail obrigatório casou com `:invalid` desde o carregamento, mas com `:user-invalid` só depois que o usuário digitou e saiu dele:

```text
state                      :invalid   :user-invalid
page load                  true       false
typing "an", still focused true       false
after leaving the field    true       true
after fixing               false      false
```

Assim, `input:user-invalid` evita o erro prematuro, embora seja validação ao sair do campo e o GOV.UK ainda fizesse objeção. Um plano defensável, como julgamento, não medição: verifique nome, e-mail e telefone no envio ou depois do campo, dê feedback ao vivo em regras de senha e disponibilidade de nome de usuário, e valide tudo de novo no servidor.

## Equívocos Comuns e Armadilhas

- **"Validação inline aumenta o sucesso em 22%."** Isso é uma melhor variante contra um controle, com 22 pessoas, em um formulário de cadastro.
- **"Estudos mostram que o rótulo tem de ir em cima."** Um estudo de eye tracking com amostra não informada mostra diferenças de velocidade. O conselho de Wroblewski mantém o alinhamento à esquerda para dados que você quer que as pessoas ponderem.
- **"`type="number"` para tudo que tem dígito."** A especificação diz não para identificadores. O Exemplo 2 mostra por quê.
- **"Passar no axe significa que o formulário é acessível."** O Exemplo 3 mostra duas falhas que ele não detecta.
- **Regras que rejeitam dados reais.** Hífens, espaços, acentos e apóstrofos em respostas válidas são problema do formulário, não do usuário.

## Resumo

Rótulos são obrigatórios, e sua posição se apoia em evidência escassa. `type` define semântica e validação, `inputmode` apenas sugere um teclado, `autocomplete` nomeia o dado e `pattern` o restringe, e `type=number` é errado para códigos. O caso a favor de valores padrão em formulários é um argumento por analogia, não uma medição direta, então tenha cuidado com respostas de consequência. Os estudos conflitam sobre validação inline contra validação no envio, mas essas fontes concordam em não apontar erro antes do fim do campo, e o servidor sempre precisa verificar. Erros precisam ser identificados em texto, e uma rodada limpa do axe não prova que são.

## Documentation Links

- [Wroblewski (2009): Inline Validation in Web Forms](https://alistapart.com/article/inline-validation-in-web-forms/): o estudo da Etre com seis variantes e 22 usuários.
- [Bargas-Avila et al. (2007): Usable Error Message Presentation](https://edoc.unibas.ch/8009/): registro do repositório com o resumo dos dois estudos.
- [Bargas-Avila et al. (2010): Introducing 20 Guidelines for Usable Web Form Design](https://www.intechopen.com/chapters/10814): capítulo aberto com a revisão e as diretrizes.
- [Seckler et al. (2014): Designing Usable Web Forms](https://research.google.com/pubs/archive/42513.pdf): teste com eye tracking das 20 diretrizes, com 65 participantes.
- [Penzo (2006): Label Placement in Forms](https://www.uxmatters.com/mt/archives/2006/07/label-placement-in-forms.php): comparação de posições de rótulo com eye tracking.
- [Sherwin (2014): Placeholders in Form Fields Are Harmful](https://www.nngroup.com/articles/form-design-placeholders/): por que placeholders falham como rótulos.
- [Krause (2019): 10 Design Guidelines for Reporting Errors in Forms](https://www.nngroup.com/articles/errors-forms-design-guidelines/): orientação prática sobre fluxos de erro.
- [Nielsen (2005): The Power of Defaults](https://www.nngroup.com/articles/the-power-of-defaults/): o estudo de busca e o conselho sobre valores padrão.
- [GOV.UK Design System: Validation](https://design-system.service.gov.uk/patterns/validation/): momento, verificação no servidor e `novalidate`.
- [GOV.UK Design System: Text input](https://design-system.service.gov.uk/components/text-input/): números, `inputmode` e placeholders.
- [GOV.UK Design System: Error message](https://design-system.service.gov.uk/components/error-message/): regras de redação.
- [Laakso (2020): Why the GOV.UK Design System team changed the input type for numbers](https://technology.blog.gov.uk/2020/02/24/why-the-gov-uk-design-system-team-changed-the-input-type-for-numbers/): problemas de campo com `type=number`.
- [WHATWG HTML: The input element](https://html.spec.whatwg.org/multipage/input.html): `number`, `email` e `tel`.
- [WHATWG HTML: Form control infrastructure](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html): nomes de autofill.
- [MDN: inputmode](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode): valores e ausência de validação.
- [MDN: :user-invalid](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:user-invalid): casamento depois da interação do usuário.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): o texto normativo dos critérios de sucesso citados.
