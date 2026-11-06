---
version: 1.0
updatedAt: 2026-11-04
title: "Pesquisa com Usuários: Entrevistas, Personas e Análise de Tarefas"
summary: "Entrevistas e contextual inquiry, personas baseadas em evidência em vez de invenção, e análise hierárquica de tarefas."
---
## Objetivos de Aprendizagem

- Escolher entre entrevista e contextual inquiry pelo que cada uma mostra e não mostra sobre o comportamento.
- Atribuir o contextual inquiry a Beyer e Holtzblatt e enunciar seus quatro princípios e a estrutura da sessão.
- Escrever perguntas de entrevista que tratem de eventos passados específicos e não conduzam o participante.
- Dizer o que torna uma persona fundamentada e auditar uma, ligando cada afirmação à evidência.
- Montar uma análise hierárquica de tarefas com planos e aplicar a regra de parada de Annett e Duncan.

## Contexto e Motivação

`usability-testing-and-the-system-usability-scale` precisa de usuários e tarefas representativos, e a avaliação heurística de `nielsens-ten-heuristics-and-heuristic-evaluation` precisa de cenários realistas em sistemas de domínio específico. Nenhum dos métodos diz quem são esses usuários ou quais devem ser as tarefas. É para isso que serve a pesquisa com usuários. `requirements-elicitation-specification-and-validation` já mostrou o risco central com um pedido hipotético de exportação para Excel que era, na verdade, um jeito de mandar um relatório por email: ao dizer do que precisam, as pessoas muitas vezes descrevem uma solução que já imaginaram.

Entrevistas coletam o que as pessoas relatam, o contextual inquiry observa o trabalho enquanto ele acontece e a análise de tarefas estrutura o que foi coletado. Personas comunicam essa evidência, e sem ela são ficção.

## Teoria Central

### Entrevistas: comportamento relatado

Rosala e Pernice (2023) classificam a entrevista com usuários como atitudinal: ela coleta comportamentos, pensamentos e sentimentos relatados, enquanto um teste de usabilidade observa o comportamento com um design. Elas tratam a entrevista como um estudo, então ela parte de objetivos de pesquisa concretos, com um roteiro de poucas perguntas abertas e seguimentos. Perguntar sobre eventos específicos funciona melhor do que perguntar sobre processos gerais, porque um incidente particular ajuda a memória.

Elas também nomeiam os limites: lembrança falha, detalhes omitidos (o participante não sabe o que é relevante) e viés de desejabilidade social. A conclusão delas é que, para saber o que os usuários fazem de fato, é preciso observá-los ou coletar dados de comportamento. A qualidade dos dados também depende do entrevistador, já que perguntas que conduzem comprometem a validade.

### Contextual inquiry: Beyer e Holtzblatt

O contextual inquiry foi desenvolvido por Hugh Beyer e Karen Holtzblatt. O relato deles situa o primeiro trabalho em Contextual Design na Digital Equipment Corporation, no início da década de 1980, com a resposta de Holtzblatt às medidas de usabilidade em laboratório, uma base teórica publicada com Whiteside e Bennett em 1988 e o processo completo exposto no livro *Contextual Design*, de 1997. O contextual inquiry é a etapa de dados de campo desse processo maior. Sua base é que o trabalho fica tão habitual que as pessoas têm dificuldade de articular o que fazem e por quê. Então o entrevistador observa as pessoas trabalhando no próprio ambiente e pergunta sobre as ações à medida que elas acontecem, e os dois desenvolvem uma interpretação compartilhada.

Flaherty (2020) traz o modelo de mestre e aprendiz e quatro princípios:

| Princípio | Significado |
|---|---|
| Contexto | Observar no ambiente natural, não em laboratório ou sala de reunião |
| Parceria | Pesquisador e usuário dividem o controle da conversa |
| Interpretação | Construir uma interpretação compartilhada, conferida com o usuário |
| Foco | Saber do que o projeto precisa e deixar isso guiar a atenção |

A sessão dela tem quatro partes: **primer** (rapport, consentimento, propósito), **transition** (uma passagem explícita para a observação), **contextual interview** (observar, parar no que não entendeu, discutir) e **wrap-up** (devolver sua interpretação para correção). Beyer e Holtzblatt acrescentam que as entrevistas de campo ficam restritas a poucas horas, ao contrário de uma etnografia de semanas, porque o método precisa caber num projeto de engenharia.

Flaherty também dá um caso real. Ao redesenhar a entrada de dados de um software de seguro de automóveis, ela entrevistou especialistas, e os três relataram colar lotes de dados de veículos de uma planilha. Observar alguns deles revelou passos não mencionados: consultavam outra ferramenta para buscar informações faltantes e clicavam em Save a cada entrada manual, embora o programa salvasse sozinho. É o relato de uma profissional, com amostra pequena, dado como ilustração, e ele mostra o tipo de distância que o método procura.

O método nem sempre serve. Flaherty diz que ele não é especialmente útil para alvos simples, como um formulário de assinatura de newsletter, e que a observação direta pode ser a melhor opção quando as pessoas não podem ser interrompidas, como médicos ou controladores de voo.

### Personas: ficcionais por desenho, fundamentadas por evidência

Uma persona é uma descrição ficcional, porém realista, de um usuário típico ou alvo (Dykes, 2025). A palavra "ficcional" convida à conclusão errada, porque a pessoa é inventada e os atributos não deveriam ser. Dykes diz assim: "Personas might be made-up people, but they should be based on information about real people."

A história da técnica mostra o problema. Pruitt e Grudin (2003) ligam as representações abstratas de usuários ao marketing e creditam a Alan Cooper o foco em design, e dizem que as primeiras personas dele eram esboços grosseiros e que seu método passou depois a incluir entrevistas ou etnografia. Eles relatam esforços iniciais parecidos na Microsoft, cujo primeiro problema listado era que os personagens não convenciam, por terem sido criados em comitê ou por terem relação pouco clara com os dados. A resposta deles tem partes que dá para copiar:

- Começar de segmentações e pesquisas com usuários já existentes, e ficar em 3 a 6 personas.
- Manter um documento-base por persona, com notas de rodapé e links que amarram cada característica aos dados.
- Fazer visitas de "sanity check" com usuários que combinam com a persona em alto nível, para testar os detalhes de baixo nível.

Eles chamam ter cada afirmação gerada a partir de dados, ou ligada a eles, de "not yet quite achieved goal", então nem aquele time chegou à rastreabilidade total. Holtzblatt e Beyer citam Harley Manning: "a persona that's not backed by rich contextual data isn't valid".

Um padrão de trabalho sai dessas fontes: as afirmações se ligam à evidência, as lacunas ficam marcadas como suposições e a persona é conferida com pessoas que combinam com ela. Dykes acrescenta um filtro de conteúdo: mantenha um detalhe só se ele afetar o design ou ajudar numa decisão. Um time que escreve uma persona sem pesquisa escreveu uma lista de hipóteses. Essa lista pode ser útil como plano de pesquisa, desde que ninguém a trate como achado.

### Análise hierárquica de tarefas: Annett e Duncan

Rosala (2020), da NN/g, separa objetivo (cadastrar-se num serviço) de tarefa (preencher um formulário) e define a análise de tarefas em duas etapas: coletar informação sobre objetivos e tarefas e depois analisá-los. O conselho dela é não depender só de autorrelato ou simulação.

A abordagem hierárquica vem de "Task analysis and training design" (1967), de Annett e Duncan. O cenário importa: treinamento industrial, não interfaces de software. O problema deles era o que descrever e em que nível de detalhe, e eles avisam que tentar descrever tudo é "to court disaster". A regra deles descreve o desempenho em termos gerais e faz duas perguntas: qual a probabilidade de desempenho inadequado sem treinamento, e quanto o desempenho inadequado custaria ao sistema? Se o produto das duas for inaceitável, o desempenho é redescrito com mais detalhe, e cada operação subordinada passa pela mesma regra. A análise para quando os valores são aceitáveis ou quando os requisitos de treinamento estão claros. Assim, a profundidade varia dentro de uma mesma análise, e eles observam que estimativas grosseiras ainda ajudam. Acrescentam que os custos devem vir do patrocinador, e alertam contra ignorar a emergência rara e cara.

A prática posterior chama isso de regra P x C e acrescenta **planos**, que dizem em que ordem e sob que condições as subtarefas rodam: sequenciais, condicionais ou iterativas. Rosala observa que os planos podem capturar como novatos e especialistas diferem. O relatório fala de uma descrição hierárquica, e a sigla HTA não aparece nele.

O Usability Body of Knowledge lista limitações a ter em mente: não há regras estritas, então analistas diferentes produzem hierarquias inconsistentes, em níveis de detalhe diferentes; exige treino; e foca tarefas existentes em vez de prever. Aplicar a regra a interfaces significa ler "sem treinamento" como "sem ajuda", uma adaptação, não uma afirmação de Annett e Duncan.

## Exemplos Resolvidos

Nada abaixo relata pesquisa. Nenhuma entrevista, visita ou participante por trás destes exemplos existe. O site de agendamento da clínica é o caso fictício das lições anteriores, e todas as estimativas foram inventadas para mostrar o procedimento.

### Exemplo 1: reescrevendo um roteiro de entrevista

O objetivo de pesquisa: entender como pacientes decidem quando agendar. Compare as perguntas, não as respostas, já que aqui não há respostas.

```text
Fraca                                    Melhor
Você gosta de agendar online?            Me conte a última vez que você agendou
                                         uma consulta. Como começou?
Um lembrete seria útil?                  O que aconteceu na última vez que você
                                         perdeu ou quase perdeu uma consulta?
Você acha o calendário confuso?          Me mostre como você escolheu a data na
                                         última vez que agendou.
Com que frequência você agenda?          Quando foi a última vez? E antes dessa?
```

A coluna da esquerda é fechada, entrega a ideia pronta ou pede um hábito geral. A da direita se ancora num evento e deixa o conteúdo com o participante. Mesmo assim, as respostas continuam sendo relatos, então o que for importante vai para a lista de observação.

### Exemplo 2: auditando uma persona

A persona e as fontes são fictícias. A tabela mostra o formato da auditoria, e códigos de estudo como V1 representam registros que um projeto real teria.

```text
Afirmação sobre "Marina"                    Evidência        Situação
Agenda para dois filhos e para si           V1, V4, I2       ligada
Agenda pelo celular no trajeto              analytics Q2     ligada
Compara duas clínicas antes de escolher     I3, I5           ligada
Lê o campo de data como DD/MM               T2 (2 sessões)   ligada
Não gosta de ligar para a recepção          I1, I2, I5       ligada
Tem 34 anos                                 nenhuma          decorativa
Pagaria por consultas mais rápidas          nenhuma          suposição
Confia em médicos com mais avaliações       nenhuma          suposição
```

Cinco de oito afirmações se ligam à evidência, ou 62,5%, número que descreve esta auditoria e não tem limiar padrão. A idade não tem fonte e, se não mudar nenhuma decisão de design, reprova no filtro de Dykes, então só pode ficar como detalhe memorável. As duas suposições são a parte útil: viram perguntas para a próxima rodada, e nenhuma deveria justificar uma funcionalidade ainda.

### Exemplo 3: uma prioridade ponderada por persona

Pruitt e Grudin descrevem uma matriz que pontua cada funcionalidade por persona, de $-1$ (prejudica) a $+2$ (adora), com pesos por fatia de mercado. Aqui as funcionalidades, notas e pesos são inventados.

```text
                         P1   P2   P3     pesos 60/30/10   pesos 40/30/30
Remarcar em dois toques   2    1    0     150              110
Contas familiares         2   -1    1     100               80
Lembretes SMS em lote     0    1    2      50               90
Recibo impresso          -1    0    2     -40               20
```

Com 60/30/10, contas familiares ficam em segundo. Com 40/30/30, são os lembretes SMS. A ordem depende dos pesos, então os pesos precisam de evidência tanto quanto a persona. A soma parece objetiva, mas herda cada julgamento das células.

### Exemplo 4: uma HTA com regra de parada

Objetivo: marcar um horário na data indicada. Probabilidades e custos (numa escala de 1 a 5) são estimativas inventadas, e o limiar de 0,5 é uma escolha de projeto. Numa análise real, o patrocinador definiria os custos e a pesquisa informaria as probabilidades.

```text
0 Agendar a consulta
  Plano 0: faça 1; se não estiver logado, faça 2; depois 3, 4, 5.
  1 Chegar à entrada de agendamento   P=.05 C=1  PxC=.05  parar
  2 Identificar o paciente            P=.15 C=2  PxC=.30  parar
  3 Escolher especialidade e médico   P=.10 C=2  PxC=.20  parar
  4 Escolher data e hora              P=.25 C=5  PxC=1.25 redescrever
    Plano 4: faça 4.1 e 4.2; faça 4.3; se o resumo estiver errado, volte a 4.1.
    4.1 Ler o calendário              P=.20 C=5  PxC=1.00 redescrever
        4.1.1 Reconhecer ordem da data P=.20 C=5 PxC=1.00 marcar para design
        4.1.2 Separar dia da semana   P=.05 C=3  PxC=.15  parar
    4.2 Escolher um horário livre     P=.05 C=3  PxC=.15  parar
    4.3 Conferir o resumo             P=.15 C=5  PxC=.75  marcar para design
  5 Confirmar e guardar o comprovante P=.10 C=3  PxC=.30  parar
```

A profundidade é desigual, como a regra quer: o passo 1 fica numa linha, e o passo 4 desce dois níveis. Em 4.1.1 e 4.3 o requisito está claro, a outra saída da regra, e aqui ele é uma questão de design. Annett e Duncan observam, sobre movimentos que conflitam com hábitos do dia a dia, que redesenhar o trabalho pode ser mais racional do que treinar. O Plano 0 registra que um usuário logado pula o passo 2, e é assim que uma análise mantém novatos e recorrentes numa só árvore.

As estimativas carregam a decisão. Se o passo 2 tivesse $P=0{,}30$, o produto seria 0,60 e ele também precisaria de redescrição. Então declare as estimativas e reveja-as quando os dados chegarem. As folhas com produto alto também sugerem tarefas para um teste de usabilidade e um cenário para avaliadores heurísticos.

## Equívocos Comuns e Armadilhas

- **"Entrevistamos usuários, então sabemos o que eles fazem."** Entrevistas relatam. O caso do seguro mostra a distância entre relato e prática, e é a observação que a fecha.
- **"Persona é pesquisa."** Ela comunica pesquisa. Sem o vínculo com a evidência, é um conjunto de palpites com uma foto.
- **"Mais detalhe pessoal a torna mais real."** Detalhes que não mudam decisão só distraem, como alerta Dykes.
- **"A HTA foi inventada para UX."** Annett e Duncan escreveram sobre treinamento industrial, e o trabalho com interfaces a adaptou.
- **"Uma HTA precisa chegar às teclas."** A regra de parada existe para evitar isso. Completude é a falha contra a qual eles alertaram.

## Resumo

Entrevistas coletam comportamento relatado e funcionam melhor ancoradas em eventos passados específicos, com os limites declarados. O contextual inquiry, de Beyer e Holtzblatt, observa o trabalho real no local e constrói uma interpretação compartilhada por contexto, parceria, interpretação e foco. Uma persona é ficcional como personagem e deveria ser factual nos atributos: afirmações ligadas à evidência, suposições rotuladas e uma conferência com pessoas novas. A análise hierárquica de tarefas, do trabalho de Annett e Duncan de 1967 sobre treinamento, redescreve uma tarefa só onde a probabilidade de falha vezes o custo é inaceitável, e os planos registram ordem e condições.

## Documentation Links

- [Rosala and Pernice (2023): User Interviews 101](https://www.nngroup.com/articles/user-interviews/): objetivos, roteiros, perguntas abertas e limites do autorrelato.
- [Flaherty (2020): Contextual Inquiry](https://www.nngroup.com/articles/contextual-inquiry/): os quatro princípios, a estrutura da sessão, o caso do seguro e quando o método não serve.
- [Holtzblatt and Beyer: Contextual Design](https://ixdf.org/literature/book/the-encyclopedia-of-human-computer-interaction-2nd-ed/contextual-design): o relato dos autores sobre o método e sua história.
- [Dykes (2025): Personas Make Users Memorable](https://www.nngroup.com/articles/persona/): definição, fase de pesquisa e quais detalhes entram.
- [Pruitt and Grudin (2003): Personas: Practice and Theory](https://www.microsoft.com/en-us/research/wp-content/uploads/2017/03/pruitt-grudinold.pdf): documentos-base, sanity checks e a matriz de prioridade.
- [Annett and Duncan (1967): Task Analysis and Training Design](https://files.eric.ed.gov/fulltext/ED019566.pdf): o relatório mantido pelo ERIC, com a regra de parada.
- [Rosala (2020): Task Analysis](https://www.nngroup.com/articles/task-analysis/): objetivos versus tarefas, as duas etapas e os planos.
- [Usability Body of Knowledge: Hierarchical Task Analysis](https://usabilitybok.org/hierarchical-task-analysis/): planos, a regra P x C e limitações.
