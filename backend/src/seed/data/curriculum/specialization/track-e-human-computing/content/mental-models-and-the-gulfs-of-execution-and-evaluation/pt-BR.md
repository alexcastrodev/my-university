---
version: 1.0
updatedAt: 2026-11-04
title: "Modelos Mentais e os Golfos de Execução e de Avaliação"
summary: "Modelos mentais e os golfos de execução e de avaliação, com affordances, signifiers, mapeamento e feedback como as ferramentas que os reduzem."
---
## Objetivos de Aprendizagem

- Definir modelo mental e explicar por que ele é uma crença que pode estar errada e ainda assim ser útil.
- Definir os golfos de execução e de avaliação e atribuí-los com precisão.
- Usar os sete estágios da ação para localizar onde uma interação quebra.
- Manter separadas a affordance de Gibson e o uso que Norman faz da palavra, e datar "signifier" corretamente.
- Diagnosticar uma interface com affordance, signifier, mapeamento, feedback e restrição, e dizer qual golfo cada um reduz.

## Contexto e Motivação

`human-perception-and-cognition-for-interface-design` tratou do que as pessoas conseguem perceber e manter em mente. Esta lição pergunta o que fazem com isso: como alguém decide o próximo passo com um sistema e como sabe se deu certo. Esse vocabulário é usado com folga. "Affordance", em particular, tem pelo menos dois sentidos, e as discussões sobre ela geralmente vêm de pessoas usando sentidos diferentes. Termos precisos dão um jeito de dizer onde a interação quebra, em vez de dizer que ela "não parece intuitiva".

## Teoria Central

### Modelos mentais

A NN/g define assim o termo: "A mental model is what the user believes about the system (web, application, or other kind of product) at hand." Ou seja, aquilo em que o usuário acredita sobre o sistema. Três propriedades importam.

- É uma crença, baseada em experiência, não um fato sobre o sistema.
- Varia entre pessoas, já que a bagagem de cada uma varia.
- Serve para prever: as pessoas escolhem ações conforme o que esperam que aconteça.

Um modelo mental não precisa ser exato para ser útil. Precisa prever bem o bastante para a tarefa em questão. O problema começa quando o modelo prevê errado e nada na interface o corrige.

Designers não falam diretamente com usuários por meio de um produto. Tudo o que o usuário recebe é o que Norman chama de imagem do sistema (system image): as operações, os resultados e a apresentação do produto. O relato da Wikipedia sobre seus princípios lista, entre eles, um bom modelo conceitual, com uma imagem do sistema coerente e consistente. Se essa imagem sugere o modelo errado, o usuário raciocina corretamente a partir de uma premissa errada.

### Os dois golfos

O **golfo de execução** é a distância entre o que a pessoa pretende e o que o sistema permite fazer, ou o quão bem apoia aquilo. A pergunta é: como faço isto aqui?

O **golfo de avaliação** é a dificuldade de descobrir o estado do sistema e interpretá-lo em termos das próprias expectativas e intenções. A pergunta é: o que aconteceu, e é o que eu queria?

A atribuição pede cuidado, porque relatos curtos dão o crédito só a Norman. A NN/g (Whitenton, 2018) diz que os termos foram inventados em 1986 por Ed Hutchins, Jim Hollan e Don Norman, ao escreverem sobre manipulação direta no livro *User Centered System Design*, organizado por Norman e Draper. O glossário da Interaction Design Foundation diz que os termos foram introduzidos em Norman (1986) e popularizados pelo livro dele de 1988, e acrescenta que a ideia de tratar a discrepância como golfos veio de Hollan e Hutchins durante uma revisão do capítulo sobre manipulação direta. Os relatos se encaixam: a manipulação direta é dos três autores, e os textos de Norman difundiram os termos. Um artigo dos mesmos três autores, com o título "Direct Manipulation Interfaces", já havia saído na revista *Human-Computer Interaction* em 1985. Os relatos abertos citados aqui datam os termos pelo livro de 1986 e nada dizem sobre essa versão de revista.

### Os sete estágios da ação

O modelo de Norman, no capítulo 2 do livro publicado pela primeira vez em 1988, divide uma ação em estágios. O relato da Wikipedia os lista como formar o objetivo, formar a intenção, especificar uma ação e executar a ação, depois perceber o estado do mundo, interpretá-lo e avaliar o resultado. Os rótulos variam entre fontes e edições, mas a forma é a mesma: um objetivo no topo, a execução descendo até o mundo e a avaliação voltando.

```text
           objetivo
          /        \
   intenção         avaliar resultado
   especificar      interpretar estado     execução à esquerda
   executar         perceber estado        avaliação à direita
          \        /
           o mundo
```

Esta é uma ferramenta de análise. Seu valor é localizar uma falha num estágio: a pessoa tinha a intenção certa, mas não conseguiu especificar a ação, ou percebeu o resultado e o interpretou mal. Não é uma sequência medida, com tempos. O glossário da IxDF observa que essas ideias pertencem à tradição do processamento de informação, muito criticada.

### Affordance: o sentido de Gibson

O psicólogo da percepção James J. Gibson desenvolveu o termo. A Wikipedia o data no livro de 1966, enquanto Norman cita os trabalhos de Gibson de 1977 e 1979. A definição mais conhecida de Gibson, tal como citada ali a partir do livro de 1979, começa assim: "The affordances of the environment are what it offers the animal, what it provides or furnishes, either for good or ill."

O resumo do próprio Norman ajuda, porque ele é claro sobre a diferença: "To Gibson, affordances are a relationship." e "They are a part of nature: they do not have to be visible, known, or desirable." Ou seja, uma relação, parte da natureza, que não precisa ser visível nem conhecida. Uma affordance gibsoniana existe mesmo que ninguém a perceba. Uma mureta na altura do joelho oferece assento para um adulto e não para uma criança pequena, porque a affordance é relativa ao corpo de quem age, não à crença de alguém.

### Affordance: o sentido de Norman

Norman levou a palavra para o design em *The Psychology of Everyday Things* (1988), depois retitulado *The Design of Everyday Things*. Seu interesse era o que o usuário consegue perceber. Escrevendo mais tarde, ele assume parte da culpa pela confusão: "I should have used the term “perceived affordance,” for in design, we care much more about what the user perceives than what is actually true." Ou seja, "affordance percebida" teria sido o termo certo.

A distinção fica nítida nas telas. "All screens afford touching: only some detect the touch and are capable of responding." Clicar é possível em qualquer pixel, então é errado perguntar se um objeto na tela "affords clicking". Ele diz que a pergunta real é se o usuário percebe que clicar ali tem sentido. William Gaver (1991) ofereceu outra divisão útil, em affordances perceptíveis, ocultas e falsas: a oculta existe sem nenhuma informação que a mostre, e a falsa parece existir, mas não existe.

### Signifier

"Signifier" é o termo que tira a ambiguidade, e sua data importa. O conceito entrou em *The Design of Everyday Things* com a edição revista e ampliada de 2013, como relatam os verbetes da Wikipedia sobre o livro e sobre affordance. Norman, porém, já havia publicado a ideia numa coluna de 2008 para a ACM *Interactions*, "Signifiers, not affordances":

> I call any physically perceivable cue a signifier, whether it is incidental or deliberate.

O sentido de 2008 é amplo. Inclui pistas acidentais, como uma plataforma de trem vazia. A posição da coluna também é mais dura que a do livro: ela manda os designers esquecerem as affordances e diz que "The perceivable part of an affordance is a signifier" (a parte perceptível de uma affordance é um signifier). Segundo o verbete da Wikipedia, a edição de 2013 mantém os dois conceitos: affordances determinam que ações são possíveis, e signifiers comunicam onde a ação deve ocorrer.

Use esta regra de trabalho. Affordance é o que pode ser feito, e signifier é o que avisa. A forma e o rótulo de um botão são signifiers. A possibilidade de apertá-lo é a affordance.

### Mapeamento, feedback e restrições

A lista de princípios de Norman, como a Wikipedia a apresenta, inclui **mapeamentos**, as relações entre ações e resultados e entre controles e seus efeitos, e **feedback**, a informação que o usuário recebe sobre o resultado das ações. **Restrições** limitam o que pode ser feito. Sua página sobre affordances dá um exemplo limpo de como separar essas coisas: "The cursor is not an affordance; it is visual feedback."

| Ferramenta | Golfo principal | O que faz |
|---|---|---|
| Signifier | Execução | Mostra o que pode ser feito e onde |
| Mapeamento | Ambos | Faz o controle prever o efeito e a tela mostrá-lo |
| Restrição | Execução | Remove ações erradas |
| Feedback | Avaliação | Informa o que aconteceu e o estado atual |
| Estado visível | Avaliação | Mostra como as coisas estão, mesmo sem ação recente |

A tabela é um resumo organizador desta lição, não vem de uma fonte.

## Exemplos Resolvidos

### Exemplo 1: um modelo mental que passa em toda checagem

Alguém que está começando no Git acredita que `git commit` salva o trabalho no servidor da equipe. Depois do commit, roda `git status`. A saída abaixo é do Git 2.50.1, num repositório com um commit ainda não enviado:

```text
On branch main
Your branch is ahead of 'origin/main' by 1 commit.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean
```

Percorra os estágios. O objetivo é compartilhar o trabalho. A execução parece ir bem, pois o comando de commit dá certo. Na avaliação, quem passa o olho lê "nothing to commit, working tree clean" como "pronto". A saída, na verdade, contém a correção, na segunda e na terceira linhas. Este é um golfo de avaliação com causa no modelo mental: o feedback está correto, mas precisa do modelo de dois repositórios para ser interpretado. Quem projetou o comando reduziu o golfo, já que a dica nomeia a próxima ação.

### Exemplo 2: classifique quatro controles

A classificação abaixo é uma análise desta lição sobre padrões comuns, e nenhum estudo a produziu.

| Controle | Ação possível? | Signifier? | Diagnóstico |
|---|---|---|---|
| Texto cinza sublinhado que não faz nada | Não | Sim, parece link | Sinal falso: signifier sem a ação |
| Deslizar uma linha para a esquerda para excluir | Sim | Nenhum | Oculta: golfo de execução, salvo se aprendida em outro lugar |
| Botão acinzentado sem motivo informado | Agora não | Sim, mas falta a causa | Restrição sem explicação |
| Botão com rótulo, anel de foco, estado de hover | Sim | Sim | Perceptível |

O deslizar oculto não é defeito automático: para especialistas pode ser um atalho rápido, desde que exista outra rota visível.

### Exemplo 3: um interruptor liga e desliga

O artigo da NN/g sobre os golfos descreve um interruptor de Bluetooth do Windows 10, com um rótulo ao lado indicando o estado atual. Empurrá-lo na direção da palavra "Off" o ligava, o oposto de um interruptor físico deslizante, em que se empurra na direção do estado desejado. O artigo observa que o problema diminui quando vários interruptores em estados diferentes estão visíveis e propõe como alternativa uma caixa de seleção, que depende de uma marca e não da posição. Uma aparência familiar convoca um modelo familiar, e o comportamento precisa combinar com ele.

### Exemplo 4: uma confirmação que não permite avaliar

Volte ao alerta do Havaí em `what-hci-studies-users-tasks-and-context`. O relatório da FCC diz que a confirmação dizia "Are you sure that you want to send this Alert?", igual para teste e para alerta real, e que não dava chance de revisar o texto a ser enviado. Em termos de golfos, o último passo antes de uma ação irreversível não dava informação para avaliá-la: a confirmação pedia uma decisão e não mostrava nada sobre o que decidir. Uma confirmação que nomeasse o público real e mostrasse o texto da mensagem reduziria esse golfo.

O limite dessa correção também vem do relatório. O agente acreditava que o ataque era real, então avaliar melhor o alerta talvez não mudasse a decisão. Aqui o modelo mental errado se formou antes da tela, no modo como o exercício foi anunciado. As ferramentas de design desta lição atacam o golfo na interface e não consertam uma crença errada sobre o mundo.

### Exemplo 5: tempo do feedback

Um botão fictício de envio de arquivo leva 3 segundos para responder, sem mostrar nada nesse intervalo. As pessoas apertam de novo e criam duplicatas. O golfo é de avaliação: nada distingue "trabalhando" de "ignorado". Usando a orientação de `human-perception-and-cognition-for-interface-design`, o botão deve reconhecer o toque em cerca de 0,1 segundo e mostrar que há trabalho em andamento. Ao mesmo tempo, uma restrição deve desativar um segundo toque, e depois de cerca de 10 segundos um indicador de progresso deve dizer quanto falta.

## Equívocos Comuns e Armadilhas

- **"Este botão tem boa affordance."** Na tela, isso geralmente quer dizer que ele tem um bom signifier. Diga isso.
- **"Gibson e Norman querem dizer o mesmo."** As affordances de Gibson existem independentemente da percepção, e o interesse de Norman era o que o usuário percebe.
- **"Signifier é uma ideia de 2013."** Entrou no livro em 2013. O uso publicado por Norman data pelo menos da coluna de 2008.
- **"Golfos de Norman" sem outros nomes.** O trabalho sobre manipulação direta é de Hutchins, Hollan e Norman, e o glossário da IxDF credita a ideia dos golfos a Hollan e Hutchins.
- **"Os usuários têm o modelo mental errado, precisam de treinamento."** Muitas vezes, mas pode ser que a imagem do sistema tenha ensinado esse modelo.

## Resumo

Um modelo mental é a crença de um usuário sobre um sistema, usada para prever o que vai acontecer. O golfo de execução é a distância da intenção à ação disponível, e o golfo de avaliação é a distância do estado do sistema ao entendimento. Os termos vêm do trabalho de Hutchins, Hollan e Norman sobre manipulação direta e dos textos de Norman de 1986 e 1988. A affordance de Gibson é uma relação entre quem age e o ambiente que existe mesmo sem ser percebida, e o uso inicial de Norman dizia respeito ao que é percebido. Seu "signifier", numa coluna de 2008 e depois na edição de 2013, separa a pista da ação. Signifiers, mapeamentos, restrições e feedback reduzem os golfos, e nenhum deles conserta uma crença errada formada em outro lugar.

## Documentation Links

- [Whitenton (2018): The Two UX Gulfs](https://www.nngroup.com/articles/two-ux-gulfs-evaluation-execution/): definições, a atribuição a 1986 e o exemplo do interruptor de Bluetooth.
- [IxDF: Gulf of Evaluation and Gulf of Execution](https://ixdf.org/literature/book/the-glossary-of-human-computer-interaction/gulf-of-evaluation-and-gulf-of-execution): definições, a origem dos termos e uma nota sobre as críticas ao quadro.
- [Chan (2024): Mental Models and User Experience Design](https://www.nngroup.com/articles/mental-models/): o que é um modelo mental e como ele se forma.
- [Wikipedia: Seven stages of action](https://en.wikipedia.org/wiki/Seven_stages_of_action): os estágios como listados a partir do livro de Norman.
- [Wikipedia: The Design of Everyday Things](https://en.wikipedia.org/wiki/The_Design_of_Everyday_Things): as edições, o acréscimo de signifiers em 2013 e a lista de princípios.
- [Wikipedia: Affordance](https://en.wikipedia.org/wiki/Affordance): a definição de Gibson, o uso de Norman e as categorias de Gaver.
- [Norman: Affordances and Design](https://jnd.org/affordances-and-design/): Norman sobre o sentido de Gibson e sobre affordances percebidas.
- [Norman (2008): Signifiers, not affordances](https://jnd.org/signifiers-not-affordances/): versão do autor da coluna da Interactions.
- [FCC (2018): Report on the Hawaii False Alert](https://docs.fcc.gov/public/attachments/DOC-350119A1.pdf): a redação da confirmação e a crença do agente.
