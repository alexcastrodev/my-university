---
version: 1.0
updatedAt: 2026-11-04
title: "Engenharia Semiótica: Comunicabilidade e a Mensagem do Designer"
summary: "Engenharia semiótica: a interface como mensagem do designer ao usuário, e o método de avaliação de comunicabilidade com suas etiquetas de ruptura."
---
## Objetivos de Aprendizagem

- Enunciar a tese central da engenharia semiótica: a interação é metacomunicação dos designers para os usuários.
- Classificar signos de interface como estáticos, dinâmicos ou metalinguísticos.
- Listar as 13 etiquetas de avaliação de comunicabilidade em inglês e português e distinguir os pares que compartilham um sintoma.
- Executar os três passos de análise do Método de Avaliação de Comunicabilidade: etiquetagem, interpretação e perfil semiótico.
- Explicar affordances perdidas e recusadas, e por que o método é qualitativo.

## Contexto e Motivação

`mental-models-and-the-gulfs-of-execution-and-evaluation` olha a interação pela cabeça do usuário: a pessoa consegue descobrir o que fazer e o que aconteceu? `color-typography-and-icons` trata cor, tipografia e ícones como material de design. A engenharia semiótica, desenvolvida por Clarisse Sieckenius de Souza e pelo Semiotic Engineering Research Group (SERG) da PUC-Rio desde 1990, acrescenta um participante que essas visões deixam fora de cena: o designer.

O ponto de De Souza é que uma interface não apenas oferece ações. Ela diz alguma coisa, em nome de alguém. Um teste de usabilidade pode relatar que as pessoas não acharam uma função. Esta teoria pergunta o que o sistema disse a elas, o que elas entenderam e onde essa conversa se rompeu. Na avaliação dela, os modelos de design centrado no usuário deixam de fora a produção de sentido dos designers, que "do not belong in UCD interaction models".

O tratamento completo é o livro de De Souza de 2005, que é vendido. O capítulo dela na enciclopédia, um artigo de 2000 e um estudo de caso do SERG de 2006 são abertos.

## Teoria Central

### Metacomunicação

A tese central é que a interação humano-computador é **metacomunicação**: comunicação sobre como, quando, onde e por que se comunicar com o sistema. Os designers não podem estar presentes quando alguém usa o software, então se representam na interface. A interface é o **preposto do designer** (designers' deputy). De Souza resume a mensagem:

> Here is my understanding of who you are, what I've learned you want or need to do, in which preferred ways, and why. This is the system that I have therefore designed for you, and this is the way you can or should use it in order to fulfill a range of purposes that fall within this vision.

O "eu" é o designer. Os usuários desdobram essa mensagem aos poucos, ao interagir. Duas consequências decorrem disso. A mensagem é unidirecional no momento da interação: o designer não pode reformulá-la. E o meio é computacional, então os designers precisam produzir representações com um único significado codificado, enquanto os usuários continuam produzindo sentidos livremente. O sistema não consegue raciocinar até o que o usuário quis dizer se os designers não previram aquilo.

**Comunicabilidade** é a qualidade que a teoria avalia: De Souza a define como a capacidade de um sistema de significar e comunicar a intenção dos designers.

### Três classes de signos

- **Signos estáticos** carregam o sentido em um instante e podem ser lidos em uma captura de tela: um ícone da barra, um rótulo, um layout.
- **Signos dinâmicos** precisam de tempo e são lidos ao longo de estados: um diálogo que abre depois de um clique, um botão de verificação ortográfica que avisa estar desativado.
- **Signos metalinguísticos** são signos sobre outros signos: uma página de ajuda, uma dica de campo, um vídeo instrucional.

### O Método de Avaliação de Comunicabilidade

O método (MAC, em inglês CEM, de Communicability Evaluation Method) testa usuários e depois reconstrói como a mensagem dos designers foi recebida. O estudo de caso do SERG de 2006 descreve dois passos preparatórios e três de análise.

**Preparação e aplicação.** Estude a documentação e a aplicação e, se possível, converse com os designers. Selecione cenários em que a comunicação tende a falhar. Recrute poucos participantes, entreviste-os antes e depois e grave a tela.

**1. Etiquetagem.** Assista à gravação e associe uma etiqueta a cada momento de ruptura. As etiquetas são expressões estereotipadas que o avaliador "puts in the participant's mouth". De Souza, Prates e Carey (2000) notam que especialistas, designers ou os próprios usuários podem etiquetar, e que cada um introduz seus vieses.

**2. Interpretação.** Tabule as etiquetas por frequência, contexto e sequência, por participante e por tarefa, e relacione-as a problemas. O SERG remete a explicação a cinco categorias: o usuário não consegue expressar o que quer dizer, escolhe o jeito errado de expressar, não consegue interpretar o que o sistema expressa, escolhe a interpretação errada, ou nem chega a formular uma intenção comunicativa.

**3. Perfil semiótico.** Reconstrua a mensagem global respondendo a cinco perguntas: quem os designers acham que são os usuários, o que acham que eles querem e precisam, que preferências supõem e por quê, que sistema projetaram em consequência e qual é sua visão global de design.

### As 13 etiquetas

A tabela traz as etiquetas exatamente como o estudo de caso do SERG as lista, com os termos em português de Mattos (2010), dissertação da UFMG orientada por Raquel Prates. Os sintomas são resumos curtos. O tipo de falha vem da tabela de Mattos, que classifica a falha como temporária (o usuário percebe e tenta superar), parcial ou completa. Nenhuma das fontes imprime as duas listas lado a lado, então o pareamento aqui segue as descrições dos sintomas.

| Etiqueta | Português | Sintoma | Falha |
|---|---|---|---|
| Where is it? | Cadê? | Sabe o que fazer, não acha o elemento | Temporária |
| What now? | E agora? | Não sabe o que fazer em seguida, vaga | Temporária |
| What's this? | O que é isso? | Não entende um signo, sonda-o | Temporária |
| Oops! | Epa! | Uma ação errada, corrigida na hora | Temporária |
| Where am I? | Onde estou? | Diz coisas próprias de outro contexto | Temporária |
| I can't do it this way. | Assim não dá. | Abandona um caminho de vários passos e toma outro | Temporária |
| Why doesn't it? | Por que não funciona? | Repete uma ação cujos efeitos não são os esperados | Temporária |
| What happened? | Ué, o que houve? | Repete porque o efeito é ausente ou não percebido | Temporária |
| Help! | Socorro! | Busca ajuda, documentação ou uma pessoa | Temporária |
| I can do otherwise. | Vai de outro jeito. | Não percebe o caminho previsto, usa um desvio | Parcial |
| Thanks, but no, thanks. | Não, obrigado. | Entende o caminho previsto e o recusa de propósito | Parcial |
| Looks fine to me. | Para mim está bom. | Acha que atingiu o objetivo, e não atingiu | Completa |
| I give up. | Desisto. | Acha que o objetivo é inatingível e para | Completa |

As grafias variam. Vasconcelos e Monteiro (2025) escrevem "O que é isto?" e "Não, Obrigado!", e o artigo de 2000 menciona "I can't do it." para o abandono consciente de uma tarefa, onde a tabela de 2006 tem "I give up." Diga sempre qual lista está usando.

Vários pares exigem cuidado, e muitas vezes a gravação da tela sozinha não os separa:

- **Cadê? / E agora?** O mesmo vagar. No primeiro, o usuário sabe o objetivo. O SERG diz que isso costuma ser assunto da entrevista pós-teste.
- **Por que não funciona? / Ué, o que houve?** No primeiro, o usuário vê efeitos, e eles estão errados. No segundo, não vê nenhum.
- **Vai de outro jeito. / Não, obrigado.** Mesmo comportamento, atitude diferente. A entrevista, ou o uso anterior da affordance na gravação, separa os dois.
- **Para mim está bom. / Desisto.** Ambas são falhas de tarefa, com atitudes opostas.

"Socorro!" é especial: o SERG a chama de um tipo de etiqueta de metanível e nota que pode ser curiosidade, e não ruptura.

### Affordances perdidas e recusadas

De Souza, Prates e Carey (2000) tomam a fala dos designers sobre "oferecer" coisas como expressão de intenção. O usuário que não percebe o caminho projetado e acha outro **perde** a affordance (missing, "Vai de outro jeito."). O que a percebe e escolhe outra coisa **recusa** a affordance (declining, "Não, obrigado."). Eles chamam esses casos de a diferença mais significativa entre a avaliação de comunicabilidade e outros métodos de usabilidade. Também separam níveis: **operacional** (ações isoladas), **tático** (um caminho de ações) e **estratégico** (como o problema é concebido). Um usuário pode recusar em um nível por causa de algo perdido em outro. Um deles recusou templates porque não percebeu que podem conter tags variáveis.

### Que tipo de resultado é este

O MAC é qualitativo. O SERG afirma que os resultados dependem da profundidade das associações semióticas que os avaliadores estabelecem, não do número de testes, e que a explicação do método é descritiva, não preditiva. O artigo de 2000 diz que seus estudos não tiveram, nem pretendiam ter, significância estatística. Mattos acrescenta que a ausência de etiquetas significa falta de evidência de problemas, não que eles não existam. Um método irmão, a inspeção semiótica, é analítico: um especialista percorre a interface procurando rupturas potenciais, sem usuários.

## Exemplos Resolvidos

### Exemplo 1: uma sessão publicada

O estudo de caso do SERG comparou dois editores de HTML, Arachnophilia e SpiderPad, com 10 participantes de experiência variada em HTML, nenhum dos quais tinha usado qualquer um deles. Um grupo começou por cada editor. As tarefas incluíam uma lista aninhada, uma cor de fundo e uma tabela, com no máximo 4 minutos cada. Estes são dados observados, e o trecho narrado do Arachnophilia traz 12 etiquetas:

```text
Where is it?             4
What's this?             3
Oops!                    2
I can do otherwise.      1
I can't do it this way.  1
Looks fine to me.        1
```

A sequência importa tanto quanto a contagem. O trecho abre com "Where is it?" e depois "I can do otherwise": o usuário parece procurar um assistente de listas e então digita os números à mão. Mattos, citando Prates e Barbosa (2007), lê esse padrão como o usuário tentando comunicar algo e adotando um caminho não ótimo. O trecho termina com "Looks fine to me.", porque o usuário declarou a tarefa concluída, embora a lista não estivesse recuada, sem nunca visualizar a página.

### Exemplo 2: lendo os totais publicados

No estudo inteiro, o SERG relata estas ocorrências, para subconjuntos de etiquetas:

```text
                                                   Arachnophilia  SpiderPad
Falha de tarefa ("I give up", "Looks fine to me")  36             31
Where is it?, Oops!, What's this?,
What happened?, Why doesn't it?                    97             108
```

Nenhuma diferença é apresentada como resultado estatístico. O valor está na explicação. A maioria dos participantes disse que o SpiderPad era mais fácil, mas os problemas de atribuição de sentido foram mais frequentes nele. Sua ajuda é seca e impessoal, enquanto o designer do Arachnophilia fala em primeira pessoa, em estilo de tutorial. O perfil responde à pergunta 1 de forma diferente para cada um: o Arachnophilia fala com quem está aprendendo HTML, o SpiderPad com quem já codifica. Função por função, os editores têm muito em comum, e a conclusão do SERG é que uma funcionalidade dirigida a outro interlocutor pode nunca ser usada.

### Exemplo 3: ilustração com um formulário

**Esta sessão foi inventada para mostrar o procedimento. Nada aqui foi observado, e nenhum participante existe.** O sistema é o formulário de entrega de `forms-and-input-design`, com um campo de cupom e um botão "Limpar" acrescentados.

```text
tempo  evento inventado                                     etiqueta
0:12   para o ponteiro sobre "CEP", esperando uma dica      O que é isso?
0:48   digita 01310 100, recebe erro, redigita igual        Por que não funciona?
1:10   abre a página de perguntas frequentes                Socorro!
2:05   abre menus procurando onde vai o cupom               Cadê?
2:20   clica em Limpar, restaura os campos na hora          Epa!
2:55   chega à página seguinte, diz que o cupom foi
       aplicado, mas não foi                                Para mim está bom.
```

Pelos tipos de Mattos, são 5 falhas temporárias e 1 completa. Interpretação: o "Por que não funciona?" aponta para uma dica que diz "com ou sem hífen" e cala sobre espaços, um signo que os designers escreveram sem prever o formato deste usuário. O "Para mim está bom." é o grave, já que o sistema nunca significou se o cupom foi aplicado. O perfil perguntaria então com quem esses designers achavam que estavam falando: alguém que já conhece o formato do CEP e não precisa de confirmação. Isso mostra como um avaliador raciocina e não é evidência sobre nenhum formulário.

### Exemplo 4: perdida ou recusada

Dois casos reais de De Souza, Prates e Carey (2000), com o SpiderPad. Um participante construiu uma tabela inteira pelo menu TAGS e nunca percebeu que a barra de ferramentas tinha uma ferramenta de tabela. Isso é "Vai de outro jeito.": a affordance foi perdida. Outro usou a barra de tags para itens de lista e depois digitou os `<li>` restantes à mão. A gravação mostra que ele tinha usado a affordance, então a conhecia, e isso faz do caso um "Não, obrigado." Os comportamentos se parecem: ambos tomaram uma rota mais longa que a do designer. A evidência de consciência os separa, e o redesign muda. Uma affordance perdida pede um signo melhor. Uma recusada pode significar que o caminho oferecido é pior para uso frequente ou, como os autores notam, que os usuários estão adaptando a ferramenta com criatividade.

## Equívocos Comuns e Armadilhas

- **"Etiquetas são citações."** São falas estereotipadas que o avaliador atribui. O artigo de 2000 compara a etiquetagem por especialistas a colocar palavras na boca do usuário.
- **"Menos etiquetas significa design melhor."** O artigo de 2000 avisa que poucos casos podem vir de uso inicial ou de uma gama de affordances tão estreita que o usuário não consegue fazer nada diferente.
- **"Comunicabilidade é usabilidade com outro nome."** Um usuário pode entender a mensagem e recusá-la. No estudo do SERG, a maioria chamou de mais fácil o editor com mais problemas de sentido.
- **"A entrevista é opcional."** Sem ela, vários pares de etiquetas muitas vezes não se distinguem.
- **Inventar uma etiqueta.** O conjunto é definido. Não acrescente "Lento demais!" e chame o resultado de MAC.

## Resumo

A engenharia semiótica, de Clarisse de Souza e do SERG, trata a interação como metacomunicação: os designers enviam uma mensagem única sobre quem são os usuários e como usar o sistema, pela interface como preposto, com signos estáticos, dinâmicos e metalinguísticos. Comunicabilidade é o quanto essa mensagem chega. O Método de Avaliação de Comunicabilidade grava usuários, etiqueta rupturas com 13 expressões estereotipadas, interpreta as etiquetas e reconstrói a mensagem em um perfil semiótico. Seus resultados distintivos são as affordances perdidas e recusadas, nos níveis operacional, tático e estratégico. Ele explica em vez de prever, e as entrevistas são essenciais para distinguir etiquetas parecidas.

## Documentation Links

- [de Souza: Semiotics, Encyclopedia of Human-Computer Interaction, 2nd ed.](https://ixdf.org/literature/book/the-encyclopedia-of-human-computer-interaction-2nd-ed/semiotics): a teoria nas palavras da autora, com a mensagem de metacomunicação e as classes de signos.
- [de Souza, Prates, Carey (2000): Missing and Declining Affordances](https://www.scielo.br/j/jbcos/a/6nykpPHBs7ZCHZg4ddJSw6v/?lang=en): os três passos, os níveis de affordance e cenários de boas e más notícias.
- [SERG (2006): Communicability Evaluation Case Study](https://id-book.pages.dev/downloads/casestudy_14point3.pdf): o método, a tabela das 13 etiquetas e o estudo de dois editores de HTML, no site de apoio de *Interaction Design*.
- [Mattos (2010): Uma extensão do Método de Avaliação de Comunicabilidade para sistemas colaborativos](https://repositorio.ufmg.br/bitstream/1843/SLSS-89PHM6/1/bernardoaugusto.pdf): dissertação da UFMG com as etiquetas em português e os tipos de falha.
- [Vasconcelos, Monteiro (2025): Comunicabilidade em comentários de usuários](https://sol.sbc.org.br/index.php/ihc_estendido/article/download/37766/37548): pôster recente do IHC que usa as 13 etiquetas, com variantes de grafia.
