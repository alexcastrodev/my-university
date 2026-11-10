---
version: 1.0
updatedAt: 2026-11-04
title: "O que a IHC Estuda: Usuários, Tarefas e Contexto"
summary: "IHC como disciplina: usuários, tarefas e contexto de uso, por que a interface é o sistema do ponto de vista do usuário e como isso difere de design visual apenas."
---
## Objetivos de Aprendizagem

- Dizer o que a interação humano-computador (IHC) estuda, a partir de uma definição publicada, e o que essa definição cobre além das telas.
- Descrever qualquer interação por três variáveis: quem são os usuários, que tarefa fazem e em que contexto a fazem.
- Explicar por que, do lado do usuário, a interface é o sistema, e onde essa afirmação deixa de ajudar.
- Separar design de interface de design visual, usando uma falha documentada em que a aparência da tela não foi a causa principal.
- Ler um relatório de incidente ou um estudo de campo e dizer o que ele achou, sobre quem e até onde o achado vale.

## Contexto e Motivação

`functional-vs-non-functional-requirements` lista usabilidade entre as categorias não funcionais comuns, ao lado de desempenho e segurança. Para uma especificação, a posição é justa, mas pode sugerir que usabilidade é uma propriedade que se acrescenta a um sistema pronto. A IHC parte de outro lugar. Ela pergunta o que acontece quando uma pessoa específica tenta fazer uma coisa específica com um sistema em condições específicas, e trata a resposta como questão empírica.

O resto da disciplina depende desse enquadramento. Limites de percepção e memória, modelos preditivos, testes de usabilidade, acessibilidade e internacionalização são maneiras de perguntar sobre uma das três variáveis apresentadas aqui. Os achados da área também vêm com condições, então boa parte de aprender IHC é aprender a perguntar quem foi estudado, fazendo o quê, em qual dispositivo.

## Teoria Central

### Uma definição de trabalho

A definição mais repetida vem do grupo de currículo da ACM SIGCHI, de 1992, e a HCI Bibliography a exibe assim: "Human-Computer Interaction (HCI) is a discipline concerned with the design, evaluation and implementation of interactive computing systems for human use and with the study of major phenomena surrounding them."

Em português: uma disciplina que trata do design, da avaliação e da implementação de sistemas computacionais interativos para uso humano e do estudo dos principais fenômenos ao redor deles. Duas partes dessa frase importam. Primeiro, ela une fazer (design, avaliação, implementação) e estudar (os fenômenos ao redor), então a área é ao mesmo tempo prática de engenharia e ciência empírica. Segundo, ela diz "sistemas", não "telas". Uma URA telefônica, um painel de carro e um checklist que a equipe segue em volta de um console podem caber nela. O termo em si foi popularizado pelo livro de 1983 *The Psychology of Human-Computer Interaction*, de Card, Moran e Newell.

### Usuários

"O usuário" raramente é uma pessoa só. Descrições úteis nomeiam o que muda o desempenho: conhecimento do domínio, experiência com este sistema, habilidades físicas e sensoriais, idioma e motivação. Uma mesma pessoa também ocupa posições diferentes ao longo do tempo, do primeiro uso ao especialista diário, e voltar depois de seis meses pode parecer um primeiro uso. Os componentes de usabilidade de Nielsen refletem isso ao listar separadamente aprendizado, eficiência e memorização.

Quem constrói o sistema costuma ser um mau substituto. O artigo da NN/g sobre modelos mentais aponta a distância entre os modelos mentais de designers e de usuários como um dos maiores dilemas da usabilidade. O designer sabe como o sistema funciona, e esse conhecimento não se desliga.

### Tarefas

Objetivo e tarefa são coisas diferentes. O objetivo sobrevive a um redesenho ("pagar este boleto"). Os passos pertencem ao design atual ("abrir o app do banco, achar o código, copiar, colar"). A separação importa porque um passo que só existe por causa do design pode ser removido, e um objetivo não.

Tarefas diferem em frequência, no custo de um erro e em poder desfazer esse erro. Uma ação rara e irreversível pede um design diferente de uma ação frequente e reversível. Nielsen também separa usabilidade de utilidade, que pergunta se o design faz o que os usuários precisam. Um fluxo fácil para a tarefa errada ainda fracassa.

### Contexto

Contexto de uso é tudo em volta da pessoa e da tarefa que muda o resultado:

- **Físico**: iluminação, ruído, luvas, uma mão livre, um trem em movimento.
- **Social e organizacional**: quem mais está presente, quem supervisiona, o que dizem os procedimentos, troca de turno, pressa.
- **Técnico**: qualidade da rede, idade do aparelho, outros softwares, os dados que o sistema realmente recebe.

`usability-and-its-definition-iso-9241-11` transforma essa ideia em definição: usabilidade é sempre declarada para usuários, objetivos e contexto especificados. Não existe resposta sem contexto para "isto é usável?", assim como não existe resposta sem carga para "isto é rápido?".

### A interface é o sistema, do lado do usuário

O usuário não vê a arquitetura. Ele vê o que o sistema mostra e o que acontece depois que age. A partir dessas observações constrói um modelo mental, que a NN/g define como aquilo em que o usuário acredita sobre o sistema. `mental-models-and-the-gulfs-of-execution-and-evaluation` desenvolve essa ideia. Daqui saem duas consequências.

Um sistema correto por dentro ainda pode estar errado para quem usa. Se um pagamento deu certo e a tela mostra um indicador de carregamento que nunca termina, a pessoa vai, com razão, pagar de novo.

A "interface" também é mais ampla que o layout visível. Ela inclui redação, valores padrão, mensagens de erro, latência, notificações e os procedimentos em torno do software.

A afirmação tem limite. Ela descreve o que o usuário consegue observar e não torna os detalhes internos desimportantes. Uma queda do banco de dados chega ao usuário como problema de interface, mas o conserto está no banco. A afirmação diz onde medir, não onde mora toda causa.

### Não é só design visual

O design visual decide como a informação aparece: hierarquia, cor, tipografia, espaçamento. Ele importa, e `human-perception-and-cognition-for-interface-design` mostra por que agrupamento e layout mudam o que as pessoas percebem. A IHC faz outra pergunta, com outra evidência: esta pessoa completou esta tarefa, quanto tempo levou, o que deu errado e ainda funcionaria em outras condições? Uma tela bonita pode reprovar nesse teste, e uma simples pode passar. Os dois não são rivais. O design visual é uma das camadas que a IHC avalia, junto com fluxo da tarefa, redação, feedback e o procedimento ao redor.

### Como a área sabe o que sabe

A IHC usa experimentos controlados, como os que sustentam `fitts-law-and-hicks-law`, além de testes de usabilidade, entrevistas e observação de campo. Cada um troca controle por realismo. Um experimento isola uma variável, com um grupo estreito de participantes numa tarefa estreita. Um estudo de campo vê condições reais, mas não isola causas com a mesma limpeza. Nenhum resultado se transfere sozinho, e por isso a pergunta "para quais usuários, tarefa e contexto?" volta o tempo todo nesta disciplina.

## Exemplos Resolvidos

### Exemplo 1: um recurso, três contextos

A tabela é uma ilustração construída. As pessoas e os cenários são fictícios, e nenhum estudo a produziu. O recurso é o mesmo em cada coluna: redefinir uma senha esquecida.

| Variável | Funcionário de escritório, desktop | Separador de armazém, coletor compartilhado | Aposentada, celular no ônibus |
|---|---|---|---|
| Usuários | Uso diário de computador | Treinado em um único app | Uso ocasional, texto ampliado |
| Tarefa | Recuperar acesso, sem urgência | Recuperar acesso no meio do turno, cada minuto conta | Recuperar acesso para pagar uma conta hoje |
| Contexto | Segunda tela, e-mail aberto | Luvas, sem e-mail pessoal no aparelho | Uma mão, sinal fraco |
| Falha provável | Poucas | Link vai para uma caixa que o coletor não abre | Código expira antes de chegar |

O link por e-mail está correto nas três colunas e falha na segunda, por causa de quem segura o aparelho e de onde a pessoa está. Nada no visual da página de redefinição mudaria isso.

### Exemplo 2: o falso alerta de míssil no Havaí, 2018

Em 13 de janeiro de 2018, a Agência de Gestão de Emergências do Havaí enviou um alerta real dizendo que um míssil balístico estava a caminho, terminando em "THIS IS NOT A DRILL". Não havia míssil. A correção pelos mesmos canais de alerta levou 38 minutos. Este é o relato da Federal Communications Commission (FCC), no relatório de abril de 2018.

O incidente costuma ser recontado como um deslize num menu mal desenhado. O achado principal do relatório é outro. Ele descreve o erro humano primário como uma falha em ouvir ou entender corretamente as instruções que indicavam que o exercício era um teste. Segundo o relatado, o agente no terminal acreditou que a ameaça era real, e o relatório conclui que o funcionário pretendia iniciar um alerta real. O agente recusou entrevista à FCC, então esse relato se apoia numa declaração escrita repassada pela agência, em outros funcionários e numa entrevista à imprensa.

O software ainda assim tinha fraquezas, que o relatório registra:

- Alertas reais e testes internos saíam da mesma interface, com o mesmo login, e o menu suspenso listava "Test missile alert" junto de "Missile alert" na mesma tela.
- A confirmação tinha o mesmo texto para teste e para alerta real, e não mostrava a mensagem que seria enviada.

Organizados pelas três variáveis, os outros achados do relatório ficam assim:

| Variável | Achado do relatório |
|---|---|
| Usuários | Os outros agentes do turno entenderam que era exercício e este não; o relatório da própria agência registra preocupações anteriores com este funcionário |
| Tarefa | O roteiro do exercício misturou a frase "This is not a drill" da mensagem real |
| Contexto | O exercício ocorreu na troca de turno, sem aviso, o supervisor do dia não estava na central de alerta e nenhum segundo agente precisava confirmar |

Essa organização é uma inferência desta lição, e o relatório não usa essas categorias. Como o agente pretendia enviar um alerta real, uma distinção visual mais forte entre dois itens de menu não teria impedido o envio de modo evidente. A lição é esta: a falha estava na redação de um procedimento, na equipe e nas salvaguardas, e tudo isso faz parte da interface no sentido amplo. Os usuários importam também de outro modo. O relatório descreve membros surdos de uma associação nacional que se abrigaram numa sala sem janelas, onde não recebiam as transmissões de rádio e televisão que diziam que o alerta era falso.

### Exemplo 3: um modelo preciso numa clínica real

Beede e colegas (CHI 2020) estudaram um sistema de aprendizado profundo para detectar doença ocular diabética em uso em clínicas na Tailândia. O método foi observação e entrevistas com enfermeiras em onze clínicas. O achado central do resumo é uma tensão entre os limiares de qualidade de dados do modelo e a qualidade dos dados que surgem num ambiente imperfeito e com poucos recursos.

O resumo do Google sobre o trabalho acrescenta detalhes concretos: a iluminação variava entre clínicas e podia afetar a qualidade da imagem, e o sistema podia, por cautela, rotular como "ungradable" (sem condição de avaliação) imagens com borrões ou áreas escuras. Nos termos desta lição, os usuários eram enfermeiras num fluxo de triagem, e o contexto incluía a sala e o equipamento. O estudo é qualitativo e trata dessas clínicas. Ele mostra que o desempenho em laboratório não decide como um sistema se comporta num dado lugar, e não dá uma taxa que valha para outros lugares.

### Exemplo 4: qual variável uma mudança toca?

Uma equipe fictícia propõe quatro mudanças num app de aprovação de despesas. Classificá-las mostra quais podem afetar a conclusão da tarefa e que evidência cada uma exigiria.

| Mudança proposta | Camada | Evidência de que funcionou |
|---|---|---|
| Nova paleta e novos ícones | Visual | Preferência, mais uma checagem de que o contraste não piorou |
| Preencher o centro de custo a partir do cadastro | Tarefa | Menos campos digitados, menos pedidos rejeitados |
| Enfileirar aprovações sem conexão | Contexto | Taxa de conclusão em conexões ruins |
| Botões maiores | Usuários e contexto | Taxa de erro das pessoas e aparelhos em uso de fato |

Só a primeira é puramente visual. Ela pode valer a pena, mas não pode alegar tarefa mais rápida sem que a tarefa tenha sido medida.

## Equívocos Comuns e Armadilhas

- **"IHC é design de UI."** A definição de 1992 inclui avaliação, implementação e o estudo dos fenômenos ao redor. O Exemplo 2 é quase todo sobre procedimentos.
- **"O operador clicou no item errado."** No Exemplo 2, os investigadores concluíram outra coisa. Confira o relatório antes de repetir a versão curta de um incidente.
- **"Erro humano" como conclusão.** O relatório nomeia um erro humano e depois lista as salvaguardas cuja ausência o deixou passar. Parar na primeira metade explica pouco.
- **"Nossos usuários são como nós."** Quem constrói sabe como o sistema funciona, e o usuário não tem como saber.
- **"Um bom resultado em laboratório se repete."** O Exemplo 3 mostra como o ambiente pode mudar o que um sistema faz. O inverso também vale: um achado de campo em onze clínicas não é uma taxa universal.
- **"Usável" sem qualificação.** Diga para quem, fazendo o quê e onde.

## Resumo

A IHC estuda sistemas interativos para uso humano, unindo design, avaliação e implementação ao estudo dos fenômenos ao redor. Três variáveis organizam esse trabalho: usuários, tarefas e contexto. Do lado do usuário, a interface é o sistema, porque o que ela mostra e faz é tudo o que a pessoa consegue observar, e ela se estende à redação, à latência e aos procedimentos. O design visual é uma camada disso e não responde se a tarefa deu certo. O relatório do Havaí e o estudo nas clínicas tailandesas mostram falhas que um olhar sobre a tela não revelaria, e cada achado vale para suas próprias pessoas e seu próprio lugar.

## Documentation Links

- [HCI Bibliography](https://hcibib.org/): exibe a definição de IHC do SIGCHI Curriculum Development Group, de 1992.
- [Wikipedia: Human-computer interaction](https://en.wikipedia.org/wiki/Human%E2%80%93computer_interaction): panorama da área e origem do termo.
- [Nielsen (2012, reviewed 2026): Usability 101](https://www.nngroup.com/articles/usability-101-introduction-to-usability/): os cinco componentes de qualidade e a distinção entre usabilidade e utilidade.
- [Chan (2024): Mental Models and User Experience Design](https://www.nngroup.com/articles/mental-models/): o que é um modelo mental e a distância entre designers e usuários.
- [FCC (2018): Report on the Hawaii False Alert](https://docs.fcc.gov/public/attachments/DOC-350119A1.pdf): cronologia, causas e salvaguardas do incidente de 13 de janeiro de 2018.
- [Beede et al. (2020): A Human-Centered Evaluation of a Deep Learning System Deployed in Clinics](https://research.google/pubs/a-human-centered-evaluation-of-a-deep-learning-system-deployed-in-clinics-for-the-detection-of-diabetic-retinopathy/): resumo do estudo de campo em onze clínicas na Tailândia.
- [Google (2020): Healthcare AI systems that put people at the center](https://blog.google/innovation-and-ai/technology/health/healthcare-ai-systems-put-people-center/): a organização dos autores resume o mesmo trabalho de campo, incluindo iluminação e imagens sem condição de avaliação.
