---
version: 1.0
updatedAt: 2026-09-06
title: "Controle de Fluxo do TCP: A Janela Deslizante"
summary: "O controle de fluxo protege um receptor lento de um remetente rápido: o receptor anuncia quanto espaço livre de buffer tem, e a janela do remetente encolhe ou cresce para acompanhar. É uma preocupação distinta do controle de congestionamento (que protege a rede, e não o receptor), mesmo que os dois usem a palavra “janela”."
---
## Objetivos de Aprendizagem

- Definir o controle de fluxo como a proteção de um receptor lento contra um remetente rápido, distinto da proteção da própria rede pelo controle de congestionamento.
- Explicar o campo de janela de recepção e como o receptor o calcula e anuncia com base na ocupação do seu próprio buffer.
- Rastrear como a taxa de envio permitida a um remetente se ajusta conforme a janela de recepção anunciada encolhe ou cresce.
- Explicar o caso da "janela zero" e como um remetente fica sabendo quando o buffer de um receptor antes cheio se esvaziou.
- Enunciar com clareza por que o controle de fluxo e o controle de congestionamento, apesar de ambos serem chamados de "janelas", resolvem problemas genuinamente diferentes e são calculados de forma independente.

## Contexto e Motivação

A transferência confiável de dados do TCP, recém-coberta, garante que quaisquer bytes enviados eventualmente cheguem corretamente e em ordem, mas não diz nada sobre quão *rápido* um remetente tem permissão de enviá-los. Duas preocupações inteiramente separadas governam a taxa de envio, e este conceito cobre a primeira: o controle de fluxo, que protege a aplicação receptora de ser sobrecarregada por dados mais rápido do que consegue consumi-los. A segunda preocupação (o controle de congestionamento, protegendo os enlaces compartilhados da rede de serem sobrecarregados) é desenvolvida no próximo conceito. As duas são, mecanicamente, expressas como uma "janela" que limita quantos dados não confirmados o remetente pode ter em trânsito, e é genuinamente fácil confundi-las; este conceito é deliberadamente estreito, cobrindo só o controle de fluxo, especificamente para que a distinção fique clara antes que o controle de congestionamento introduza a sua própria janela, com motivação diferente.

## Teoria Central

### O problema que o controle de fluxo resolve

Um receptor TCP tem um buffer de recepção finito: os dados que chegam são colocados ali conforme chegam, e removidos conforme a aplicação receptora os lê. Se um remetente transmite mais rápido do que a aplicação receptora lê, o buffer de recepção pode encher por completo, e quaisquer dados adicionais que chegarem, sem lugar para serem guardados, teriam que ser descartados, precisamente o tipo de perda que a transferência confiável de dados trabalha duro para não causar, para começo de conversa. O controle de fluxo existe especificamente para evitar isso: ele permite que o remetente saiba quanto espaço livre de buffer o receptor tem no momento, para que o remetente nunca transmita mais dados não confirmados do que o receptor de fato consegue guardar.

### O campo de janela de recepção

Todo segmento TCP enviado pelo receptor de volta ao remetente inclui um campo de janela de recepção, calculado como o espaço livre atual do buffer do receptor: `RcvWindow = RcvBuffer - (LastByteReceived - LastByteRead)`, ou seja, a capacidade total do buffer menos quantos dados estão atualmente parados nele, recebidos mas ainda não lidos pela aplicação. O remetente é obrigado a manter a quantidade de dados não confirmados em trânsito igual ou abaixo da janela de recepção anunciada mais recentemente: a permissão real "em trânsito" do remetente encolhe e cresce dinamicamente conforme o buffer do receptor enche e esvazia.

### O problema da janela zero e as sondagens

Se a aplicação receptora para de ler por completo (talvez esteja ocupada com outra coisa, ou momentaneamente travada), o buffer de recepção pode encher por completo, e o receptor anuncia uma janela de recepção de 0, instruindo o remetente a parar de enviar qualquer dado adicional até que o receptor tenha espaço de novo. Isso cria um problema sutil: quando o buffer esvazia e o espaço fica disponível de novo, como o remetente fica sabendo, se ele parou de enviar por completo e, portanto, não tem nada para disparar um ACK novo carregando uma janela atualizada? O TCP resolve isso com um mecanismo de persistência: o remetente envia periodicamente um pequeno segmento de sondagem (carregando um byte de dados) especificamente para provocar um ACK novo do receptor, que vai reportar uma janela não nula quando o buffer tiver de fato esvaziado. Sem as sondagens, uma janela zero poderia de outro modo deixar uma conexão travada permanentemente, mesmo depois que o receptor estivesse pronto para aceitar mais dados.

## Exemplos Resolvidos

### Exemplo 1: Calculando a janela de recepção conforme os dados chegam e são lidos

A capacidade total do buffer do receptor é 8.000 bytes. No momento, 3.000 bytes foram recebidos, mas ainda não lidos pela aplicação.

```text
RcvWindow = RcvBuffer - (LastByteReceived - LastByteRead)
          = 8.000 - 3.000
          = 5.000 bytes
```

O receptor anuncia uma janela de 5.000 bytes, dizendo ao remetente que ele pode ter até 5.000 bytes de dados não confirmados em trânsito. Se a aplicação então ler 2.000 dos bytes bufferizados (liberando esse espaço), a janela anunciada do próximo ACK cresce para 7.000 bytes, mesmo sem nenhum dado novo ter chegado: a janela reflete o espaço livre, que muda tanto quando dados chegam (encolhendo-a) quanto quando a aplicação lê (fazendo-a crescer).

### Exemplo 2: O buffer enchendo por completo: uma janela zero

Continuando o mesmo cenário: o remetente, vendo espaço, envia mais dados, e a aplicação receptora para de ler (ocupada com outro trabalho). O buffer enche por inteiro:

```text
RcvWindow = 8.000 - 8.000 = 0
```

O receptor anuncia uma janela de 0. O remetente agora precisa parar de enviar quaisquer dados de aplicação novos: enviar mais arriscaria que os dados fossem descartados, já que o receptor genuinamente não tem onde colocá-los.

### Exemplo 3: Recuperando-se de uma janela zero via persistência

```text
1. O receptor anuncia janela = 0. O remetente para de enviar dados.
2. O tempo passa. A aplicação receptora volta a ler e esvazia 3.000 bytes
   do buffer. O receptor agora genuinamente tem 3.000 bytes de espaço
   livre -- mas não tem dados próprios a enviar, então não tem razão
   natural para enviar um segmento novo reportando isso.
3. O remetente envia periodicamente um segmento de sondagem de 1 byte
   especificamente para provocar uma resposta.
4. O receptor responde à sondagem com um ACK carregando o valor ATUAL da
   janela: 3.000 bytes (e não o 0 desatualizado do passo 1).
5. O remetente, agora informado de que a janela é não nula de novo, volta
   a enviar dados de aplicação, até o limite recém-anunciado de 3.000 bytes.
```

Sem estas sondagens periódicas, a conexão poderia travar indefinidamente mesmo depois que o receptor estivesse genuinamente pronto para aceitar mais: a sondagem existe puramente para forçar uma atualização de janela nova de um receptor que de outro modo ficaria em silêncio.

## Equívocos Comuns e Armadilhas

- **"O controle de fluxo e o controle de congestionamento são o mesmo mecanismo."** O controle de fluxo protege o *buffer do receptor* de ser sobrecarregado pelo remetente; o controle de congestionamento (o próximo conceito) protege os *enlaces compartilhados da rede* de serem sobrecarregados por todos os remetentes coletivamente. Eles são calculados de forma independente, usando informações diferentes, e a taxa real permitida a um remetente é o mínimo das duas janelas, e não qualquer uma delas sozinha.
- **"Uma janela de recepção encolhendo significa que a rede está congestionada."** Uma janela de recepção encolhendo reflete o *buffer do receptor* enchendo (a aplicação receptora lendo mais devagar do que os dados chegam); ela não diz nada sobre as condições da rede, que é exatamente a distinção que a janela separada do controle de congestionamento é necessária para capturar.
- **"Uma janela zero significa que a conexão falhou."** Uma janela zero é uma condição normal, esperada e temporária quando o buffer de um receptor está genuinamente cheio; o mecanismo de persistência/sondagem existe especificamente para se recuperar dela graciosamente quando o receptor tiver espaço de novo, e não para sinalizar um erro.
- **"O remetente pode enviar quantos dados quiser, desde que não exceda a janela de recepção."** Os dados em trânsito de fato permitidos ao remetente são limitados pela *menor* entre a janela de recepção (este conceito) e a janela de congestionamento (o próximo conceito): satisfazer só o controle de fluxo não basta se a janela de congestionamento estiver no momento mais restritiva.

## Resumo

O controle de fluxo protege o buffer finito de um receptor TCP de ser sobrecarregado por um remetente mais rápido: o receptor anuncia continuamente o seu espaço livre atual de buffer como uma janela de recepção, e o remetente é obrigado a manter os seus dados em trânsito, não confirmados, iguais ou abaixo desse valor anunciado. Quando a aplicação receptora fica para trás e o buffer enche por completo, o receptor anuncia uma janela de 0, e uma sondagem de persistência periódica do remetente é o que permite à conexão se recuperar quando o receptor eventualmente esvaziar o seu buffer e tiver espaço de novo. O controle de fluxo é deliberadamente distinto do controle de congestionamento (coberto a seguir): um protege o receptor, o outro protege a rede, e a taxa de envio real e efetiva de um remetente é governada por qualquer das duas janelas que estiver no momento menor.

## Documentation Links

- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão do controle de fluxo do TCP, da janela de recepção e do mecanismo de persistência da janela zero.
