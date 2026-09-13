---
version: 1.0
updatedAt: 2026-09-06
title: Higiene de Commit
summary: Um commit é uma unidade de comunicação para leitores futuros, não um ponto de salvamento; commits atômicos (uma mudança lógica) são revisáveis e reversíveis isoladamente, e uma mensagem que explica por que, não o que, é a única coisa que o diff nunca pode mostrar.
---
## Objetivos de Aprendizagem

- Explicar por que um commit é uma unidade de comunicação para leitores futuros, não meramente um ponto de salvamento em uma ferramenta.
- Distinguir um commit atômico (uma mudança lógica) de um commit que empacota várias mudanças não relacionadas juntas.
- Escrever uma mensagem de commit cujo corpo explica *por que* uma mudança foi feita, não meramente reafirma o que o diff já mostra.
- Avaliar se uma dada mensagem de commit ainda seria útil para alguém (incluindo seu próprio autor) lendo-a meses depois sem nenhum outro contexto.
- Identificar o custo prático que um projeto paga quando seu histórico de commit é inconsistente ou pouco informativo.

## Contexto e Motivação

Uma vez que uma equipe adotou feature branches e uma linha principal sempre funcional, uma pergunta mais sutil permanece: como qualquer commit *individual* deveria de fato parecer? Git aceitará de bom grado um commit que empacota uma correção de bug, uma renomeação, uma passagem de formatação não relacionada, e uma nova funcionalidade meio-terminada tudo em um, com uma mensagem que só diz "atualizações", nada na mecânica do git previne isso. Mas um commit não é só um mecanismo para salvar um snapshot; também é, quer o autor pense nisso dessa forma ou não, uma mensagem deixada para quem quer que leia o histórico do projeto depois, um revisor decidindo se aprova uma mudança, um colega de equipe tentando entender por que uma linha particular parece do jeito que parece, ou o próprio autor original, seis meses depois, tendo há muito esquecido o raciocínio que parecia óbvio na época.

Essa é precisamente a lacuna para a qual o tratamento de ferramentas git do Missing Semester aponta quando se move além da mecânica bruta para como commits são de fato usados em projetos reais: o log de commit é o registro mais detalhado, mais preciso de um projeto sobre *por que* o código parece do jeito que parece, disponível em nenhum outro lugar, não em um documento de design, não em um comentário, porque comentários descrevem o estado atual do código enquanto uma mensagem de commit pode descrever o raciocínio por trás de uma *mudança*, incluindo alternativas que foram consideradas e rejeitadas. As diretrizes de engenharia de software do CS2013 do ACM/IEEE tratam esse tipo de disciplina de histórico de projeto como uma prática real, avaliável, não uma questão de gosto pessoal, precisamente porque o histórico de um projeto ou funciona como um recurso usável para a equipe ou não, e esse resultado é determinado inteiramente por se commits individuais foram feitos com alguma disciplina.

O insight central que vale a pena internalizar é específico: o diff anexado a um commit já mostra *o que* mudou, em detalhe exato, não ambíguo, toda linha adicionada e removida está bem ali. O que o diff nunca pode mostrar, não importa quão cuidadosamente seja lido, é *por que* aquela mudança era a certa a fazer, que problema estava resolvendo, que alternativa foi considerada e rejeitada, ou o que quebraria se fosse revertida. Uma mensagem de commit que só reafirma o diff em prosa ("mudou a condição do laço") não adiciona nada que um leitor não pudesse já ver por si mesmo; uma mensagem de commit que explica o raciocínio por trás da mudança é o único lugar onde aquele raciocínio é registrado afinal.

## Teoria Central

### Um commit como uma unidade de comunicação, não só um ponto de salvamento

Tratar um commit como "só um ponto de salvamento" leva naturalmente a fazer commit sempre que é conveniente, com o que quer que esteja em progresso, e descrevê-lo de qualquer forma que venha à mente rapidamente, o equivalente a apertar Ctrl+S. Tratá-lo em vez disso como uma unidade deliberada de comunicação significa perguntar, antes de fazer commit, duas perguntas separadas: esse commit representa uma mudança coerente, descritível (não várias não relacionadas empacotadas juntas), e sua mensagem explica aquela mudança de uma forma que um leitor sem nenhum outro contexto poderia de fato usar? Ambas as perguntas importam independentemente, um commit bem descrito que empacota três mudanças não relacionadas ainda é difícil de revisar, reverter, ou entender isoladamente, e um commit atômico, focado, com uma mensagem pouco informativa ainda falha em comunicar qualquer coisa útil sobre por que existe.

### Commits atômicos: uma mudança lógica por commit

Um commit atômico contém exatamente o conjunto de mudanças necessário para realizar um propósito coerente, corrigir um bug, adicionar um pequeno pedaço de funcionalidade, renomear uma coisa consistentemente, e nada mais. O ganho prático aparece especificamente quando algo precisa depois ser desfeito, revisado, ou entendido isoladamente: `git revert` em um commit atômico limpamente desfaz exatamente uma mudança lógica; `git revert` em um commit que empacotou uma correção de bug junto com uma passagem de formatação não relacionada ou desfaz ambas juntas ou exige desemaranhá-las manualmente depois do fato. Similarmente, um revisor examinando um commit atômico de cada vez pode avaliar "essa mudança faz sentido" como uma única pergunta limitada, em vez de tentar manter várias mudanças não relacionadas em mente simultaneamente para julgar se o commit como um todo é aceitável.

### A anatomia de uma mensagem de commit útil

Uma mensagem de commit que comunica bem tipicamente tem duas partes: uma linha de resumo curta enunciando o que mudou, e, para qualquer coisa além da mudança mais trivial, um corpo explicando *por que* mudou. A linha de resumo existe para folhear um histórico rapidamente (`git log --oneline`); o corpo existe para o momento em que alguém de fato precisa entender a mudança profundamente, e é o corpo, não o resumo, que deveria carregar o raciocínio: que problema isso resolve, por que essa abordagem particular foi escolhida sobre uma alternativa que poderia parecer mais óbvia, e que restrição ou relatório de bug a motivou em primeiro lugar. Nada disso é visível no próprio diff, o diff só jamais mostra as linhas resultantes, nunca o raciocínio que as produziu.

### Por que "o que mudou" é redundante com o diff

Toda linha de código que mudou já é visível, precisa e não ambiguamente, no momento em que qualquer um olha para o diff do commit. Uma mensagem que só reafirma isso em prosa, "mudou a contagem de tentativas de 3 para 5" para um diff que visivelmente muda `3` para `5`, adiciona o valor de uma frase de texto e zero informação adicional; qualquer um lendo o commit já tem o diff aberto. A única informação que uma mensagem de commit pode adicionar que o diff não pode é o *por quê*: "aumentou a contagem de tentativas de 3 para 5 porque o próprio SLA da API de pagamento permite até 4 segundos de 503s transitórios sob carga, e 3 tentativas no nosso cronograma de backoff atual não era margem suficiente" não está visível em lugar nenhum no diff, não importa quão cuidadosamente seja lido, só existe se alguém o escreveu.

## Exemplos Resolvidos

### Exemplo 1 — uma mensagem pouco informativa versus uma que explica o raciocínio

**Cenário:** a lógica de repetição em um cliente de processamento de pagamento é mudada de 3 tentativas para 5.

**Diff (idêntico em ambos os casos):**
```diff
- MAX_RETRIES = 3
+ MAX_RETRIES = 5
```

**Mensagem de commit, versão A:**
```
fix stuff
```

**Mensagem de commit, versão B:**
```
Increase payment API retry count from 3 to 5

Under sustained load, the payment provider's own status page documents
up to 4 seconds of transient 503 responses before recovering. At our
current exponential backoff schedule (200ms, 400ms, 800ms), 3 retries
only covers about 1.4 seconds of margin — not enough to ride out a
typical transient outage. Bumped to 5 retries (up to ~6.2 seconds of
margin) after confirming with the on-call payments engineer that this
still stays under our own request-timeout budget of 10 seconds.

Fixes the intermittent "payment failed" reports from ticket PAY-482,
which line up exactly with provider-side 503 spikes in the logs.
```

Ambas as mensagens ficam em cima do diff idêntico de uma linha. A versão A não diz a um leitor futuro nada que não pudesse já ver lendo o próprio diff, "fix stuff" nem sequer especifica qual dos dois números era o problema. A versão B responde toda pergunta que alguém revisitando essa linha meses depois de fato teria: por que 5 e não algum outro número, por que isso não arrisca violar o orçamento de timeout geral, e qual sintoma real, voltado ao usuário, motivou a mudança afinal, nada disso o diff poderia jamais mostrar por si só, não importa quanto tempo seja encarado.

### Exemplo 2 — um commit empacotado versus dividi-lo em atômicos

**Cenário:** enquanto corrige um bug em `calculate_discount()`, um desenvolvedor também nota algum código não relacionado por perto que está formatado inconsistentemente, e reflexivamente o limpa na mesma sessão.

**Commit empacotado (não atômico):**
```
commit 8f3a21c
Mensagem: "fix discount bug and clean up code"

Diff toca:
 - calculate_discount(): corrige um fora-por-um em um cálculo de porcentagem
 - format_receipt(): reformatado (espaço em branco, estilo de aspas) — não relacionado ao bug
 - apply_tax(): reformatado (espaço em branco) — também não relacionado
```

Três meses depois, a reformatação de `apply_tax()` acaba tendo introduzido uma mudança sutil em arredondamento de float que ninguém pegou em revisão porque estava enterrada entre 40 linhas de diff de espaço em branco não relacionado. Reverter só a regressão de arredondamento de imposto significa ou reverter esse commit inteiro, que também desfaz a correção correta do bug de desconto e a reformatação inofensiva do recibo, ou manualmente separar quais linhas pertencem a qual das três mudanças não relacionadas.

**Dividido em commits atômicos:**
```
commit A: "Fix off-by-one in calculate_discount() percentage math"
  (toca só calculate_discount())

commit B: "Reformat format_receipt() for consistent quote style"
  (toca só format_receipt())

commit C: "Reformat apply_tax() whitespace"
  (toca só apply_tax())
```

Com o trabalho dividido dessa forma, a regressão de arredondamento de imposto pode ser revertida com `git revert <hash-do-commit-C>` sozinho, desfazendo exatamente a mudança responsável, e nada mais. A correção de desconto e a reformatação do recibo permanecem intocadas, porque nunca foram emaranhadas com a mudança que causou o problema em primeiro lugar.

## Equívocos Comuns e Armadilhas

- **"Mensagens de commit são uma formalidade que ninguém de fato lê."** São lidas constantemente, só não sempre pelo autor original, e nem sempre imediatamente, por um revisor decidindo se aprova uma mudança, por `git blame` quando alguém está tentando entender por que uma linha específica existe, pelo próprio autor original depois que tempo suficiente passou que o raciocínio não é mais memória, só histórico.
- **"Fazer commit frequentemente significa fazer commit do que quer que esteja atualmente no diretório de trabalho."** Fazer commit frequentemente é boa prática, mas cada commit ainda precisa representar uma mudança coerente, descritível, "faça commit frequentemente" não é licença para empacotar três edições não relacionadas juntas só porque aconteceram de existir no mesmo momento; dividi-las, como no Exemplo 2, custa pouco e compensa substancialmente depois.
- **"O diff já explica tudo, então a mensagem pode só dizer o que mudou."** O diff mostra *o que* mudou com precisão perfeita e nunca pode mostrar *por quê*, o Exemplo 1 demonstra isso diretamente: o diff é idêntico em ambas as versões, e só a mensagem que explica o raciocínio dá a um leitor futuro qualquer coisa que o próprio diff não pudesse já ter dito a eles.
- **"Uma mensagem de commit longa significa que a mudança foi complicada ou arriscada."** O comprimento da mensagem deveria rastrear quanto contexto um leitor de outra forma estaria perdendo, não quão grande o diff é, um diff de uma linha pode merecer várias frases de explicação (Exemplo 1), enquanto uma mudança grande, mecânica, autoexplicativa (uma renomeação direta aplicada em todo lugar) pode precisar de pouco mais que sua linha de resumo.
- **"Limpar código não relacionado enquanto corrige um bug é eficiente, economiza uma segunda viagem."** Como o Exemplo 2 mostra, empacotar mudanças não relacionadas em um commit troca uma pequena conveniência agora por um custo real depois: revisões mais difíceis, reversões mais difíceis, e um histórico onde "o que de fato causou essa regressão" exige desemaranhar várias edições não relacionadas depois do fato.

## Resumo

Um commit é melhor entendido como uma unidade de comunicação direcionada a um leitor futuro, um revisor, um colega de equipe, ou o próprio autor original meses depois, não meramente um mecanismo para salvar progresso. Duas disciplinas fazem essa comunicação de fato útil: manter cada commit atômico, para que represente exatamente uma mudança lógica, descritível, e possa ser revisado ou revertido isoladamente; e escrever uma mensagem cujo corpo explica *por que* a mudança foi feita, já que o próprio diff já mostra *o que* mudou em detalhe completo, não ambíguo e não adiciona nada quando meramente reafirmado em prosa. Um commit empacotado e uma mensagem pouco informativa ambos custam tempo real depois, em revisões confusas, em reversões emaranhadas, em um histórico que não mais responde à única pergunta para a qual existe: por que o código parece do jeito que parece.

## Documentation Links

- [The Missing Semester of Your CS Education (MIT)](https://missing.csail.mit.edu/) — doc
- [ACM/IEEE CS2013 — Software Engineering Knowledge Area](https://csed.acm.org/knowledge-areas-software-engineering-se-cs2013-version/) — doc
